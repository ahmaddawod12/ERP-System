"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { LoadingState } from "@/components/states/loading-state";
import { EmptyState } from "@/components/states/empty-state";
import { useAppContext } from "@/hooks/use-app-context";
import { useAppToast } from "@/hooks/use-toast";
import { useDocumentTask } from "@/hooks/use-document-task";
import { listDocuments, listClients, resolveCompanyScope } from "@/lib/services/firestore-service";
import type { DocumentRecord, ClientRecord } from "@/lib/types";

/* ─── Document type codes (matches phone app) ─── */

const DOCUMENT_TYPES = [
  { code: 10, label: "Price Proposal", suffix: "PP" },
  { code: 200, label: "Delivery Note", suffix: "DN" },
  { code: 210, label: "Return Certificate", suffix: "RC" },
  { code: 305, label: "Tax Invoice", suffix: "TI" },
  { code: 330, label: "Refund", suffix: "RF" },
  { code: 400, label: "Receipt", suffix: "RE" },
] as const;

type DocTypeCode = (typeof DOCUMENT_TYPES)[number]["code"];

function getDocTypeLabel(code: number): string {
  return DOCUMENT_TYPES.find((dt) => dt.code === code)?.label ?? `Type ${code}`;
}

/* ─── Item row ─── */

interface DocumentItem {
  description: string;
  price: number;
  quantity: number;
  partId?: number;
}

const emptyItem = (): DocumentItem => ({ description: "", price: 0, quantity: 1 });

/* ─── Page ─── */

type ViewMode = "history" | "create";

export default function DocumentsClient() {
  const { companyId } = useAppContext();
  const { toast } = useAppToast();

  const companyScopeId = resolveCompanyScope(companyId);

  /* ── History state ── */
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("history");

  /* ── Document detail modal ── */
  const [viewingDocument, setViewingDocument] = useState<DocumentRecord | null>(null);

  /* ── Create form state ── */
  const [docType, setDocType] = useState<DocTypeCode>(10);
  const [language, setLanguage] = useState<"he" | "en" | "ar">("he");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // Client
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [manualClient, setManualClient] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    vatNumber: "",
  });

  // Items
  const [items, setItems] = useState<DocumentItem[]>([emptyItem()]);

  // Payment (receipt)
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentInfo, setPaymentInfo] = useState("");

  /* ── Preview / Generate state ── */
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [generatedURL, setGeneratedURL] = useState<string | null>(null);
  const [generatedDocId, setGeneratedDocId] = useState<string | null>(null);
  const [confirmationNumber, setConfirmationNumber] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  /* ── Document task hook (Pub/Sub) ── */
  const {
    publishPreview,
    publishGenerate,
    getInvoiceApproval,
    reset: resetTask,
    isLoading: taskLoading,
    error: taskError,
    taskStatus,
  } = useDocumentTask({
    onPreviewComplete: (url) => {
      setPreviewURL(url);
      setShowPreviewModal(true);
    },
    onGenerateComplete: (url, docId) => {
      setGeneratedURL(url);
      setGeneratedDocId(docId);
      setShowSuccessModal(true);
      void loadRecords(); // refresh history
    },
    onError: (err) => {
      toast({ title: "Document task failed", description: err, variant: "error" });
    },
  });

  /* ── Load data ── */

  const loadRecords = useCallback(async () => {
    if (!companyScopeId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await listDocuments(companyScopeId);
      setRecords(result);
    } catch {
      // silent
    }
    setLoading(false);
  }, [companyScopeId]);

  const loadClients = useCallback(async () => {
    if (!companyScopeId) {
      setClients([]);
      return;
    }
    try {
      const { clients: nextClients } = await listClients(companyScopeId);
      setClients(nextClients);
    } catch {
      // silent
    }
  }, [companyScopeId]);

  useEffect(() => {
    void loadRecords();
    void loadClients();
  }, [loadRecords, loadClients]);

  /* ── Filtered clients ── */
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.vatNumber?.toLowerCase().includes(q),
    );
  }, [clients, clientSearch]);

  /* ── Client helpers ── */
  const clientData = useMemo(() => {
    if (selectedClient) {
      return {
        name: selectedClient.name,
        phone: selectedClient.phone || "",
        email: selectedClient.email || "",
        address: selectedClient.address || "",
        city: selectedClient.city || "",
        vatNumber: selectedClient.vatNumber || "",
        clientId: selectedClient.id,
      };
    }
    return { ...manualClient, clientId: "" };
  }, [selectedClient, manualClient]);

  /* ── Totals ── */
  const totals = useMemo(() => {
    const validItems = items.filter((i) => i.description.trim() && i.price > 0);
    const totalBeforeVat = validItems.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0,
    );
    const vatAmount = Math.round(totalBeforeVat * 0.18 * 100) / 100;
    const totalWithVat = Math.round((totalBeforeVat + vatAmount) * 100) / 100;
    return { totalBeforeVat, vatAmount, totalWithVat };
  }, [items]);

  /* ── Build document data payload (matches phone app) ── */
  const buildDocumentData = useCallback(() => {
    const validItems = items
      .filter((i) => i.description.trim() && i.price > 0)
      .map((i) => ({
        description: i.description,
        price: i.price,
        quantity: i.quantity,
        ...(i.partId ? { partId: i.partId } : {}),
      }));

    const data: Record<string, unknown> = {
      client: {
        name: clientData.name,
        phone: clientData.phone,
        email: clientData.email,
        address: clientData.address,
        city: clientData.city,
        vatNumber: clientData.vatNumber,
        ...(clientData.clientId ? { clientId: clientData.clientId } : {}),
      },
      items: validItems,
      language,
      date,
      notes,
      totalBeforeVat: totals.totalBeforeVat,
      vatAmount: totals.vatAmount,
      totalWithVat: totals.totalWithVat,
    };

    if (docType === 400) {
      data.paymentMethod = paymentMethod;
      data.paymentInfo = paymentInfo;
    }

    return data;
  }, [items, clientData, language, date, notes, totals, docType, paymentMethod, paymentInfo]);

  /* ── Validation ── */
  const validate = useCallback((): string | null => {
    if (!clientData.name.trim()) return "Client name is required";
    if (docType === 305 && !clientData.vatNumber?.trim()) {
      return "VAT number is required for Tax Invoices";
    }
    const validItems = items.filter((i) => i.description.trim() && i.price > 0);
    if (validItems.length === 0) return "At least one item with a price is required";
    return null;
  }, [clientData, docType, items]);

  /* ── Get the numeric document type code expected by Cloud Functions ── */
  const getDocumentTypeCode = useCallback((): number => {
    return docType;
  }, [docType]);

  /* ── Preview ── */
  const handlePreview = async () => {
    const err = validate();
    if (err) {
      toast({ title: "Validation error", description: err, variant: "error" });
      return;
    }
    if (!companyScopeId) return;

    try {
      await publishPreview({
        documentType: getDocumentTypeCode(),
        companyId: companyScopeId,
        documentData: buildDocumentData(),
      });
    } catch {
      // error is handled via onError callback
    }
  };

  /* ── Generate ── */
  const handleGenerate = async () => {
    const err = validate();
    if (err) {
      toast({ title: "Validation error", description: err, variant: "error" });
      return;
    }
    if (!companyScopeId) return;

    setShowPreviewModal(false);

    if (docType === 305) {
      // Tax Invoice → getInvoiceApproval on me-west1
      try {
        const docData = buildDocumentData();
        const result = await getInvoiceApproval({
          companyId: companyScopeId,
          type: 305,
          // Spread top-level fields as backend expects (not nested under documentData)
          client: docData.client as Record<string, unknown>,
          items: docData.items as Array<Record<string, unknown>>,
          language: docData.language as string,
          date: docData.date as string,
          notes: docData.notes as string,
        });
        if (result.confirmationNumber) {
          setConfirmationNumber(result.confirmationNumber);
        }
        toast({
          title: "Tax Authority approved",
          description: "Generating PDF...",
          variant: "success",
        });
      } catch {
        // error handled by onError callback
      }
    } else {
      // Non-tax-invoice → publishGenerateTask
      try {
        await publishGenerate({
          documentType: getDocumentTypeCode(),
          companyId: companyScopeId,
          documentData: buildDocumentData(),
        });
      } catch {
        // error handled by onError callback
      }
    }
  };

  /* ── Generate from preview modal ── */
  const handleGenerateFromPreview = () => {
    void handleGenerate();
  };

  /* ── Reset form ── */
  const resetForm = () => {
    setDocType(10);
    setLanguage("he");
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setSelectedClient(null);
    setClientSearch("");
    setManualClient({
      name: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      vatNumber: "",
    });
    setItems([emptyItem()]);
    setPaymentMethod("cash");
    setPaymentInfo("");
    setPreviewURL(null);
    setGeneratedURL(null);
    setGeneratedDocId(null);
    setConfirmationNumber(null);
    resetTask();
  };

  /* ── Item helpers ── */
  const updateItem = (index: number, field: keyof DocumentItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  /* ─── Render ─── */

  return (
    <ProtectedRoute section="documents">
      <section className="grid gap-4">
        {/* Header */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Documents
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {viewMode === "history"
                  ? "View document history and create new documents."
                  : "Create a new document with preview."}
              </p>
            </div>
            <Button
              variant={viewMode === "history" ? "primary" : "secondary"}
              onClick={() => {
                if (viewMode === "create") {
                  resetForm();
                }
                setViewMode(viewMode === "history" ? "create" : "history");
              }}
            >
              {viewMode === "history" ? "New Document" : "Back to History"}
            </Button>
          </div>
        </Card>

        {/* ── CREATE MODE ── */}
        {viewMode === "create" && (
          <>
            {/* Document Type Selection */}
            <Card>
              <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Document Type
              </h2>
              <div className="flex flex-wrap gap-2">
                {DOCUMENT_TYPES.map((dt) => (
                  <button
                    key={dt.code}
                    onClick={() => setDocType(dt.code as DocTypeCode)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      docType === dt.code
                        ? "bg-sky-500 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {dt.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as "he" | "en" | "ar")}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="he">Hebrew</option>
                    <option value="en">English</option>
                    <option value="ar">Arabic</option>
                  </select>
                </div>
                <Input
                  label="Date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </Card>

            {/* Client Selection */}
            <Card>
              <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Client Details
              </h2>

              {/* Client search / selector */}
              <div className="relative mb-4">
                <Input
                  label="Search existing client"
                  value={clientSearch}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setShowClientDropdown(true);
                    if (!e.target.value.trim()) setSelectedClient(null);
                  }}
                  onFocus={() => setShowClientDropdown(true)}
                  placeholder="Type to search clients..."
                />
                {showClientDropdown && filteredClients.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                        onClick={() => {
                          setSelectedClient(c);
                          setClientSearch(c.name);
                          setShowClientDropdown(false);
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.phone && (
                          <span className="text-xs text-slate-500">{c.phone}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedClient ? (
                <div className="rounded-lg bg-sky-50 p-3 dark:bg-sky-950/30">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-sky-800 dark:text-sky-300">
                      Selected: {selectedClient.name}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedClient(null);
                        setClientSearch("");
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-sky-700 dark:text-sky-400">
                    {[selectedClient.phone, selectedClient.email, selectedClient.vatNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Client Name *"
                    value={manualClient.name}
                    onChange={(e) =>
                      setManualClient((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                  <Input
                    label="Phone"
                    value={manualClient.phone}
                    onChange={(e) =>
                      setManualClient((p) => ({ ...p, phone: e.target.value }))
                    }
                  />
                  <Input
                    label="Email"
                    value={manualClient.email}
                    onChange={(e) =>
                      setManualClient((p) => ({ ...p, email: e.target.value }))
                    }
                  />
                  <Input
                    label="Address"
                    value={manualClient.address}
                    onChange={(e) =>
                      setManualClient((p) => ({ ...p, address: e.target.value }))
                    }
                  />
                  <Input
                    label="City"
                    value={manualClient.city}
                    onChange={(e) =>
                      setManualClient((p) => ({ ...p, city: e.target.value }))
                    }
                  />
                  <Input
                    label={docType === 305 ? "VAT Number *" : "VAT Number"}
                    value={manualClient.vatNumber}
                    onChange={(e) =>
                      setManualClient((p) => ({ ...p, vatNumber: e.target.value }))
                    }
                  />
                </div>
              )}
            </Card>

            {/* Items */}
            <Card>
              <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Items
              </h2>
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-[1fr_100px_80px_auto]"
                  >
                    <Input
                      label="Description"
                      value={item.description}
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                      placeholder="Item description"
                    />
                    <Input
                      label="Price"
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.price || ""}
                      onChange={(e) =>
                        updateItem(idx, "price", parseFloat(e.target.value) || 0)
                      }
                    />
                    <Input
                      label="Qty"
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(idx, "quantity", parseInt(e.target.value) || 1)
                      }
                    />
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => removeItem(idx)}
                        disabled={items.length <= 1}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="secondary"
                className="mt-3"
                onClick={addItem}
              >
                + Add Item
              </Button>

              {/* Totals */}
              <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
                <div className="flex justify-between text-sm">
                  <span>Subtotal (before VAT)</span>
                  <span className="font-medium">
                    ₪{totals.totalBeforeVat.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>VAT (18%)</span>
                  <span className="font-medium">₪{totals.vatAmount.toFixed(2)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span>₪{totals.totalWithVat.toFixed(2)}</span>
                </div>
              </div>
            </Card>

            {/* Payment (receipt only) */}
            {docType === 400 && (
              <Card>
                <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Payment Details
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                      Payment Method
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="cash">Cash</option>
                      <option value="check">Check</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="credit_card">Credit Card</option>
                      <option value="bit">Bit</option>
                    </select>
                  </div>
                  <Input
                    label="Payment Info"
                    value={paymentInfo}
                    onChange={(e) => setPaymentInfo(e.target.value)}
                    placeholder="Check number, transaction ID, etc."
                  />
                </div>
              </Card>
            )}

            {/* Notes */}
            <Card>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Notes
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  placeholder="Optional notes for the document..."
                />
              </label>
            </Card>

            {/* Task status */}
            {taskLoading && (
              <Card>
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {taskStatus === "pending"
                      ? "Submitting task..."
                      : taskStatus === "queued"
                        ? "Task queued, generating..."
                        : "Processing..."}
                  </span>
                </div>
              </Card>
            )}
            {taskError && (
              <Card>
                <p className="text-sm text-red-600">{taskError}</p>
              </Card>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => void handlePreview()}
                disabled={taskLoading}
              >
                Preview PDF
              </Button>
              <Button
                onClick={() => void handleGenerate()}
                disabled={taskLoading}
              >
                {docType === 305 ? "Submit to Tax Authority" : "Generate Document"}
              </Button>
            </div>
          </>
        )}

        {/* ── HISTORY MODE ── */}
        {viewMode === "history" && (
          <>
            {loading ? (
              <LoadingState />
            ) : records.length === 0 ? (
              <EmptyState
                title="No documents yet"
                description="Create your first document using the button above."
              />
            ) : (
              <Card>
                <DataTable
                  data={records}
                  columns={[
                    {
                      key: "type",
                      header: "Type",
                      render: (row) => (
                        <Badge variant="info">
                          {row.documentType
                            ? getDocTypeLabel(row.documentType)
                            : row.type || "Document"}
                        </Badge>
                      ),
                    },
                    {
                      key: "docNumber",
                      header: "Doc #",
                      render: (row) =>
                        row.documentNumber ??
                        row.documentId ??
                        "—",
                    },
                    {
                      key: "client",
                      header: "Client",
                      render: (row) => row.cname || "—",
                    },
                    {
                      key: "total",
                      header: "Total",
                      render: (row) =>
                        row.totalWithVat != null
                          ? `₪${Number(row.totalWithVat).toFixed(2)}`
                          : "—",
                    },
                    {
                      key: "date",
                      header: "Date",
                      render: (row) =>
                        row.date ||
                        (row.createdAt
                          ? new Date(row.createdAt).toLocaleDateString()
                          : "—"),
                    },
                    {
                      key: "confirmation",
                      header: "Confirmation",
                      render: (row) => row.confirmationNumber || "—",
                    },
                    {
                      key: "actions",
                      header: "Actions",
                      render: (row) => (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setViewingDocument(row)}
                          >
                            View
                          </Button>
                          {row.downloadURL && (
                            <a
                              href={row.downloadURL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-9 items-center rounded-lg bg-slate-200 px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                            >
                              PDF
                            </a>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </Card>
            )}
          </>
        )}

        {/* ── Preview Modal ── */}
        <Modal
          open={showPreviewModal}
          title="Document Preview"
          onClose={() => setShowPreviewModal(false)}
        >
          <div className="space-y-4">
            {previewURL ? (
              <>
                <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
                  <a
                    href={previewURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 underline hover:text-sky-500"
                  >
                    Open Preview PDF
                  </a>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowPreviewModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGenerateFromPreview}
                    disabled={taskLoading}
                  >
                    {docType === 305
                      ? "Submit to Tax Authority"
                      : "Create Document"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                <span className="text-sm">Generating preview...</span>
              </div>
            )}
          </div>
        </Modal>

        {/* ── Success Modal ── */}
        <Modal
          open={showSuccessModal}
          title="Document Generated"
          onClose={() => {
            setShowSuccessModal(false);
            resetForm();
            setViewMode("history");
          }}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Document has been successfully created.
            </p>
            {confirmationNumber && (
              <p className="text-sm">
                <span className="font-medium">Confirmation Number: </span>
                {confirmationNumber}
              </p>
            )}
            {generatedDocId && (
              <p className="text-sm">
                <span className="font-medium">Document ID: </span>
                {generatedDocId}
              </p>
            )}
            {generatedURL && (
              <a
                href={generatedURL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-sm text-sky-600 underline hover:text-sky-500"
              >
                Download PDF
              </a>
            )}
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setShowSuccessModal(false);
                  resetForm();
                  setViewMode("history");
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </Modal>

        {/* ── View Document Modal ── */}
        <Modal
          open={viewingDocument !== null}
          title={
            viewingDocument?.documentType
              ? getDocTypeLabel(viewingDocument.documentType)
              : viewingDocument?.type || "Document Details"
          }
          onClose={() => setViewingDocument(null)}
          className="max-w-2xl"
        >
          {viewingDocument && <DocumentDetail documentRecord={viewingDocument} />}
        </Modal>
      </section>
    </ProtectedRoute>
  );
}

/* ─── Document Detail Component (matches phone app ViewDocument) ─── */

function DocumentDetail({ documentRecord }: { documentRecord: DocumentRecord }) {
  return (
    <div className="space-y-4 text-sm">
      {/* Document Info */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
        {documentRecord.documentType != null && (
          <div>
            <span className="text-xs text-slate-500">Type</span>
            <p className="font-medium">{getDocTypeLabel(documentRecord.documentType)}</p>
          </div>
        )}
        {(documentRecord.documentNumber ?? documentRecord.documentId) && (
          <div>
            <span className="text-xs text-slate-500">Document #</span>
            <p className="font-medium">
              {documentRecord.documentNumber ?? documentRecord.documentId}
            </p>
          </div>
        )}
        {documentRecord.confirmationNumber && (
          <div>
            <span className="text-xs text-slate-500">Confirmation #</span>
            <p className="font-medium">{documentRecord.confirmationNumber}</p>
          </div>
        )}
        {documentRecord.date && (
          <div>
            <span className="text-xs text-slate-500">Date</span>
            <p className="font-medium">{documentRecord.date}</p>
          </div>
        )}
        {documentRecord.language && (
          <div>
            <span className="text-xs text-slate-500">Language</span>
            <p className="font-medium">
              {documentRecord.language === "he"
                ? "Hebrew"
                : documentRecord.language === "en"
                  ? "English"
                  : documentRecord.language === "ar"
                    ? "Arabic"
                    : documentRecord.language}
            </p>
          </div>
        )}
        <div>
          <span className="text-xs text-slate-500">Created</span>
          <p className="font-medium">
            {documentRecord.createdAt
              ? new Date(documentRecord.createdAt).toLocaleString()
              : "—"}
          </p>
        </div>
      </div>

      {/* Client Info */}
      {documentRecord.cname && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
            Client
          </h4>
          <div className="grid grid-cols-2 gap-1">
            <p>
              <span className="text-slate-500">Name: </span>
              {documentRecord.cname}
            </p>
            {documentRecord.cphone && (
              <p>
                <span className="text-slate-500">Phone: </span>
                {documentRecord.cphone}
              </p>
            )}
            {documentRecord.clientCity && (
              <p>
                <span className="text-slate-500">City: </span>
                {documentRecord.clientCity}
              </p>
            )}
            {documentRecord.clientVatNumber && (
              <p>
                <span className="text-slate-500">VAT: </span>
                {documentRecord.clientVatNumber}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Items */}
      {documentRecord.items && documentRecord.items.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
            Items
          </h4>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-slate-500">
                <th className="pb-1">Description</th>
                <th className="pb-1 text-right">Price</th>
                <th className="pb-1 text-right">Qty</th>
                <th className="pb-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {documentRecord.items.map((item, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1">{item.description}</td>
                  <td className="py-1 text-right">₪{Number(item.price).toFixed(2)}</td>
                  <td className="py-1 text-right">{item.quantity}</td>
                  <td className="py-1 text-right">
                    ₪{(Number(item.price) * Number(item.quantity)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      {documentRecord.totalWithVat != null && (
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>₪{Number(documentRecord.totalBeforeVat ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT (18%)</span>
            <span>₪{Number(documentRecord.vatAmount ?? 0).toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>Total</span>
            <span>₪{Number(documentRecord.totalWithVat).toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Payment (receipt) */}
      {documentRecord.paymentMethod && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <h4 className="mb-1 font-semibold">Payment</h4>
          <p>
            <span className="text-slate-500">Method: </span>
            {documentRecord.paymentMethod}
          </p>
          {documentRecord.paymentInfo &&
            typeof documentRecord.paymentInfo === "object" &&
            Object.entries(documentRecord.paymentInfo).map(([k, v]) => (
              <p key={k}>
                <span className="text-slate-500">{k}: </span>
                {String(v)}
              </p>
            ))}
        </div>
      )}

      {/* Notes */}
      {documentRecord.notes && (
        <div>
          <h4 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">
            Notes
          </h4>
          <p className="text-slate-600 dark:text-slate-400">{documentRecord.notes}</p>
        </div>
      )}

      {/* PDF link */}
      {documentRecord.downloadURL && (
        <a
          href={documentRecord.downloadURL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-400"
        >
          Open PDF
        </a>
      )}
    </div>
  );
}
