"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileText, Sparkles } from "lucide-react";
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
import {
  DOC_TYPE,
  DOCUMENT_TYPES,
  getDocumentTypeLabel,
  type DocumentTypeCode,
  VAT_RATE,
  VAT_RATE_PERCENT,
} from "@/lib/document-types";
import {
  getDocumentDownloadUrl,
  listDocuments,
  listClients,
  resolveCompanyScope,
} from "@/lib/services/firestore-service";
import type { DocumentRecord, ClientRecord } from "@/lib/types";
import { DocumentDetail } from "./components/DocumentDetail";

/* ─── Document type codes (matches phone app) ─── */

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("history");

  /* ── Document detail modal ── */
  const [viewingDocument, setViewingDocument] = useState<DocumentRecord | null>(null);

  /* ── Create form state ── */
  const [docType, setDocType] = useState<DocumentTypeCode>(DOC_TYPE.PRICE_PROPOSAL);
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
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);

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

  const loadRecordsAbortRef = useRef<AbortController | null>(null);

  const loadRecords = useCallback(async () => {
    if (!companyScopeId) {
      setRecords([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    loadRecordsAbortRef.current?.abort();
    const controller = new AbortController();
    loadRecordsAbortRef.current = controller;
    try {
      const result = await listDocuments(companyScopeId, undefined, controller.signal);
      if (!controller.signal.aborted) {
        setRecords(result.items ?? []);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : "Failed to load documents");
      }
    }
    if (!controller.signal.aborted) setLoading(false);
  }, [companyScopeId]);

  // Abort outstanding request on unmount.
  useEffect(() => () => { loadRecordsAbortRef.current?.abort(); }, []);

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
    const vatAmount = Math.round(totalBeforeVat * VAT_RATE * 100) / 100;
    const totalWithVat = Math.round((totalBeforeVat + vatAmount) * 100) / 100;
    return { totalBeforeVat, vatAmount, totalWithVat };
  }, [items]);

  /* ── Build document data payload (matches phone app) ── */
  const buildDocumentData = useCallback(() => {
    const clientVatNumber = clientData.vatNumber.trim();
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
        ...(clientVatNumber
          ? {
              clientVatNumber,
              customerVatNumber: clientVatNumber,
            }
          : {}),
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

    if (docType === DOC_TYPE.RECEIPT) {
      data.paymentMethod = paymentMethod;
      data.paymentInfo = paymentInfo;
    }

    return data;
  }, [items, clientData, language, date, notes, totals, docType, paymentMethod, paymentInfo]);

  /* ── Validation ── */
  const validate = useCallback((): string | null => {
    if (!clientData.name.trim()) return "Client name is required";
    if (docType === DOC_TYPE.TAX_INVOICE && !clientData.vatNumber?.trim()) {
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

    if (docType === DOC_TYPE.TAX_INVOICE) {
      // Tax Invoice → getInvoiceApproval on me-west1
      try {
        const docData = buildDocumentData();
        const result = await getInvoiceApproval({
          companyId: companyScopeId,
          type: DOC_TYPE.TAX_INVOICE,
          // Spread top-level fields as backend expects (not nested under documentData)
          client: docData.client as Record<string, unknown>,
          items: docData.items as Array<Record<string, unknown>>,
          language: docData.language as string,
          date: docData.date as string,
          notes: docData.notes as string,
          idempotencyKey: `tax_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
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

  const handleOpenDocumentPdf = useCallback(async (documentRecord: DocumentRecord) => {
    if (!companyScopeId) {
      toast({ title: "Document unavailable", description: "Company scope is missing.", variant: "error" });
      return;
    }

    const documentId = documentRecord.documentId ?? documentRecord.id;
    if (!documentId) {
      toast({ title: "Document unavailable", description: "Document ID is missing.", variant: "error" });
      return;
    }

    try {
      setOpeningDocumentId(documentId);
      const url = await getDocumentDownloadUrl(companyScopeId, documentId);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        window.location.assign(url);
      }
    } catch (error) {
      toast({
        title: "Unable to open PDF",
        description: error instanceof Error ? error.message : "Failed to fetch the document URL.",
        variant: "error",
      });
    } finally {
      setOpeningDocumentId(null);
    }
  }, [companyScopeId, toast]);

  /* ── Reset form ── */
  const resetForm = () => {
    setDocType(DOC_TYPE.PRICE_PROPOSAL);
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

  const latestDocument = records[0] ?? null;
  const taxDocumentCount = records.filter((record) => record.documentType === DOC_TYPE.TAX_INVOICE).length;
  const hasClientContext = Boolean(selectedClient || clientData.name.trim());
  const controlFieldClass = "dashboard-field h-11";
  const longTextClass = "dashboard-field min-h-28 resize-none";
  const taskLabel =
    taskStatus === "pending"
      ? "Submitting task..."
      : taskStatus === "queued"
        ? "Task queued, generating..."
        : "Processing...";

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  /* ─── Render ─── */

  return (
    <ProtectedRoute section="documents">
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Sparkles className="h-3.5 w-3.5" />
                Documents
              </p>
              <h1 className="dashboard-title mt-5">
                {viewMode === "history" ? "Document history and output" : "Create a document with preview"}
              </h1>
              <p className="dashboard-copy mt-4">
                {viewMode === "history"
                  ? "Review generated documents, confirmations, and PDF output in one place."
                  : "Assemble client data, line items, and tax details before generating the final document."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[24rem]">
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">History</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{records.length}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Tax invoices</p>
                <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950 dark:text-white">{taxDocumentCount}</p>
              </div>
              <div className="dashboard-stat">
                <p className="text-sm text-slate-500 dark:text-slate-400">Mode</p>
                <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 dark:text-white">
                  {viewMode === "history" ? "History" : "Create"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant={viewMode === "history" ? "primary" : "secondary"}
              onClick={() => {
                resetForm();
                setViewMode("history");
              }}
            >
              History
            </Button>
            <Button
              variant={viewMode === "create" ? "primary" : "secondary"}
              onClick={() => setViewMode("create")}
            >
              New document
            </Button>
          </div>
        </div>

        {/* ── CREATE MODE ── */}
        {viewMode === "create" && (
          <>
            <div className="grid gap-4 xl:grid-cols-[1.06fr_0.94fr]">
              <Card>
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Document setup</h2>
                    <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                      Choose the document type, language, and document date before adding details.
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                {DOCUMENT_TYPES.map((dt) => (
                  <button
                    key={dt.code}
                    onClick={() => setDocType(dt.code)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      docType === dt.code
                        ? "bg-slate-950 text-white shadow-[0_14px_36px_-22px_rgba(15,23,42,0.9)] dark:bg-white dark:text-slate-950"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {dt.label}
                  </button>
                ))}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as "he" | "en" | "ar")}
                    className={controlFieldClass}
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

              <Card>
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                    <Eye className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Generation summary</h2>
                    <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                      A quick view of the current document configuration before preview or generation.
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                    <span className="text-slate-500 dark:text-slate-400">Type</span>
                    <p className="mt-1 font-medium text-slate-950 dark:text-white">{getDocumentTypeLabel(docType)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                    <span className="text-slate-500 dark:text-slate-400">Client context</span>
                    <p className="mt-1 font-medium text-slate-950 dark:text-white">{hasClientContext ? "Ready" : "Missing"}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-slate-900/55">
                    <span className="text-slate-500 dark:text-slate-400">Items</span>
                    <p className="mt-1 font-medium text-slate-950 dark:text-white">{items.length} line item{items.length === 1 ? "" : "s"}</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Client Selection */}
            <Card>
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Client details</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Link an existing client or enter client details directly for this document.
                </p>
              </div>

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
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-[1.2rem] border border-white/70 bg-white/95 shadow-[0_24px_80px_-44px_rgba(15,23,42,0.7)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
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
                <div className="rounded-[1.2rem] border border-sky-200/80 bg-sky-50 p-4 dark:border-sky-800/60 dark:bg-sky-950/30">
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
                    label={docType === DOC_TYPE.TAX_INVOICE ? "VAT Number *" : "VAT Number"}
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
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Items</h2>
                <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Add priced line items to build the document total.
                </p>
              </div>
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-[1.2rem] border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-[1fr_100px_80px_auto]"
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
              <div className="mt-4 rounded-[1.2rem] bg-slate-50 p-4 dark:bg-slate-800/50">
                <div className="flex justify-between text-sm">
                  <span>Subtotal (before VAT)</span>
                  <span className="font-medium">
                    ₪{totals.totalBeforeVat.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>VAT ({VAT_RATE_PERCENT}%)</span>
                  <span className="font-medium">₪{totals.vatAmount.toFixed(2)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span>₪{totals.totalWithVat.toFixed(2)}</span>
                </div>
              </div>
            </Card>

            {/* Payment (receipt only) */}
            {docType === DOC_TYPE.RECEIPT && (
              <Card>
                <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Payment Details</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                      Payment Method
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className={controlFieldClass}
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
                  className={longTextClass}
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
                    {taskLabel}
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
            <Card>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Preview and generate</h2>
                  <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    Preview the PDF first, then generate the final document or send it to tax authority approval.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
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
                    {docType === DOC_TYPE.TAX_INVOICE ? "Submit to Tax Authority" : "Generate Document"}
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* ── HISTORY MODE ── */}
        {viewMode === "history" && (
          <>
            {loading ? (
              <LoadingState />
            ) : loadError ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Couldn&apos;t load documents</h2>
                    <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{loadError}</p>
                  </div>
                  <Button onClick={() => void loadRecords()}>Retry</Button>
                </div>
              </Card>
            ) : records.length === 0 ? (
              <EmptyState
                title="No documents generated yet"
                description="Create the first proposal, invoice, receipt, or tax invoice to start building document history."
              />
            ) : (
              <Card>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Generated documents</h2>
                    <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">
                      Review recent output, confirmation numbers, and downloadable PDFs.
                    </p>
                  </div>
                  {latestDocument ? <Badge variant="info">Latest: {latestDocument.cname || getDocumentTypeLabel(latestDocument.documentType ?? DOC_TYPE.PRICE_PROPOSAL)}</Badge> : null}
                </div>
                <DataTable
                  data={records}
                  columns={[
                    {
                      key: "type",
                      header: "Type",
                      render: (row) => (
                        <Badge variant="info">
                          {row.documentType
                            ? getDocumentTypeLabel(row.documentType)
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
                          {(row.storagePath || row.documentId || row.id) && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleOpenDocumentPdf(row)}
                              disabled={openingDocumentId === (row.documentId ?? row.id)}
                            >
                              PDF
                            </Button>
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
                <div className="flex items-center justify-center rounded-[1.2rem] border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
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
                    {docType === DOC_TYPE.TAX_INVOICE
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
            <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
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
              ? getDocumentTypeLabel(viewingDocument.documentType)
              : (viewingDocument?.type != null
                  ? String(viewingDocument.type)
                  : "Document Details")
          }
          onClose={() => setViewingDocument(null)}
          className="max-w-2xl"
        >
          {viewingDocument && (
            <DocumentDetail
              documentRecord={viewingDocument}
              onOpenPdf={() => void handleOpenDocumentPdf(viewingDocument)}
              isOpening={openingDocumentId === (viewingDocument.documentId ?? viewingDocument.id)}
            />
          )}
        </Modal>
      </section>
    </ProtectedRoute>
  );
}
