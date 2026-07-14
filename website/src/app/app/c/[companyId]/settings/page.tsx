import type {
  BusinessProfile,
  Viewer,
  ViewerProfile,
  WorkspaceSummary,
} from "@smart-job/api-contracts";
import { Building2, Settings2, ShieldX, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { ServerWorkspaceShell } from "@/components/layout/server-workspace-shell";
import {
  CompanyProfileForm,
  type CompanyProfileFormInitial,
} from "@/components/settings/company-profile-form";
import { ViewerProfileForm } from "@/components/settings/viewer-profile-form";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import {
  getCompanyProfile,
  getViewerProfile,
} from "@/lib/backend/profile-client";
import { BackendTransportError } from "@/lib/backend/transport-core";
import { requireWebsiteRequestContext } from "@/lib/dal/session";
import {
  findViewerWorkspace,
  parsePublicCompanyId,
} from "@/lib/dal/workspace-routing";

export const metadata = { title: "Settings | Smart-Job" };

function SettingsPageFrame({
  viewer,
  workspace,
  children,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
  children: React.ReactNode;
}) {
  return (
    <ServerWorkspaceShell viewer={viewer} workspace={workspace} activeSection="settings">
      <section className="dashboard-page" aria-labelledby="settings-heading">
        <div className="dashboard-hero">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <p className="dashboard-kicker">
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                Server-rendered account settings
              </p>
              <h1 id="settings-heading" className="dashboard-title mt-4">
                Profile and company settings
              </h1>
              <p className="dashboard-copy mt-3">
                Review the authenticated profile and selected workspace before editing. All changes use the opaque website session and runtime-validated API contracts.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{workspace.role}</Badge>
              <Badge variant="info">Company {workspace.companyId}</Badge>
            </div>
          </div>
        </div>
        {children}
      </section>
    </ServerWorkspaceShell>
  );
}

function displayValue(value: string | null): string {
  return value?.trim() || "Not provided";
}

function ProfileServerSummary({
  viewerProfile,
  businessProfile,
}: {
  viewerProfile: ViewerProfile;
  businessProfile: BusinessProfile;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" aria-label="Current server-rendered profile details">
      <Card>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <UserRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950 dark:text-white">Authenticated account</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Loaded before hydration</p>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Email</dt>
            <dd className="mt-1 break-all font-medium text-slate-950 dark:text-white">{viewerProfile.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Display name</dt>
            <dd className="mt-1 font-medium text-slate-950 dark:text-white">{displayValue(viewerProfile.displayName)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Phone</dt>
            <dd className="mt-1 font-medium text-slate-950 dark:text-white">{displayValue(viewerProfile.phoneNumber)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Profile updated</dt>
            <dd className="mt-1 font-medium text-slate-950 dark:text-white">
              <time dateTime={viewerProfile.updatedAt}>
                {new Date(viewerProfile.updatedAt).toLocaleString("en-IL")}
              </time>
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950 dark:text-white">Workspace identity</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Authoritative company record</p>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Company name</dt>
            <dd className="mt-1 font-medium text-slate-950 dark:text-white">
              {displayValue(businessProfile.heName?.trim() || businessProfile.enName)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">VAT / business number</dt>
            <dd className="mt-1 font-mono font-medium text-slate-950 dark:text-white">
              {displayValue(businessProfile.vatNumber)}
            </dd>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Immutable after onboarding</p>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Business phone</dt>
            <dd className="mt-1 font-medium text-slate-950 dark:text-white">{displayValue(businessProfile.businessPhone)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Company updated</dt>
            <dd className="mt-1 font-medium text-slate-950 dark:text-white">
              <time dateTime={businessProfile.updatedAt}>
                {new Date(businessProfile.updatedAt).toLocaleString("en-IL")}
              </time>
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function EmptyProfileNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-5 py-4 dark:border-slate-700 dark:bg-slate-950/50">
      <p className="font-medium text-slate-950 dark:text-white">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
    </div>
  );
}

function SettingsUnavailable({
  viewer,
  workspace,
}: {
  viewer: Viewer;
  workspace: WorkspaceSummary;
}) {
  return (
    <SettingsPageFrame viewer={viewer} workspace={workspace}>
      <EmptyState
        title="Settings are unavailable"
        description="The backend could not confirm active access to this workspace. No profile fields can be changed from this page."
        action={(
          <span aria-disabled="true" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
            <ShieldX className="h-4 w-4" aria-hidden="true" />
            Profile controls disabled
          </span>
        )}
      />
    </SettingsPageFrame>
  );
}

function companyFormInitial(profile: BusinessProfile): CompanyProfileFormInitial {
  return {
    heName: profile.heName ?? "",
    enName: profile.enName ?? "",
    businessType: profile.businessType ?? "",
    city: profile.city ?? "",
    address: profile.address ?? "",
    businessEmail: profile.businessEmail ?? "",
    businessPhone: profile.businessPhone ?? "",
    businessFax: profile.businessFax ?? "",
    accountantName: profile.accountantName ?? "",
    accountantEmail: profile.accountantEmail ?? "",
    accountantPhone: profile.accountantPhone ?? "",
    entityVersion: profile.entityVersion,
  };
}

export default async function CompanySettingsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId: rawCompanyId } = await params;
  const returnTo = `/app/c/${encodeURIComponent(rawCompanyId)}/settings`;
  const context = await requireWebsiteRequestContext(returnTo);
  const { viewer } = context.session;

  if (viewer.workspaces.length === 0) {
    redirect("/onboarding");
  }

  const companyId = parsePublicCompanyId(rawCompanyId);
  if (!companyId) {
    notFound();
  }

  // Reject forged tenant URLs before either profile API receives company scope.
  const membership = findViewerWorkspace(viewer.workspaces, companyId);
  if (!membership) {
    notFound();
  }

  let viewerProfile: ViewerProfile;
  let businessProfile: BusinessProfile;
  try {
    [viewerProfile, businessProfile] = await Promise.all([
      getViewerProfile(companyId, context.sessionToken),
      getCompanyProfile(companyId, context.sessionToken),
    ]);
  } catch (error) {
    if (error instanceof BackendTransportError && error.status === 401) {
      redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
    }
    if (error instanceof BackendTransportError && error.status === 403) {
      return <SettingsUnavailable viewer={viewer} workspace={membership} />;
    }
    if (error instanceof BackendTransportError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const canEditCompany = membership.role === "manager" || membership.role === "dev";
  const personalProfileEmpty = viewerProfile.displayName === null
    && viewerProfile.phoneNumber === null;
  const companyProfileEmpty = [
    businessProfile.heName,
    businessProfile.enName,
    businessProfile.businessType,
    businessProfile.city,
    businessProfile.address,
    businessProfile.businessEmail,
    businessProfile.businessPhone,
    businessProfile.businessFax,
    businessProfile.accountantName,
    businessProfile.accountantEmail,
    businessProfile.accountantPhone,
  ].every((value) => value === null);

  return (
    <SettingsPageFrame viewer={viewer} workspace={membership}>
      <ProfileServerSummary
        viewerProfile={viewerProfile}
        businessProfile={businessProfile}
      />

      {personalProfileEmpty ? (
        <EmptyProfileNotice
          title="Your workspace profile is empty"
          description="Add a display name or phone number so managers and coworkers can identify you."
        />
      ) : null}

      <ViewerProfileForm
        key={viewerProfile.updatedAt}
        companyId={companyId}
        initial={{
          displayName: viewerProfile.displayName,
          phoneNumber: viewerProfile.phoneNumber,
        }}
      />

      {companyProfileEmpty ? (
        <EmptyProfileNotice
          title="Company contact details are empty"
          description={canEditCompany
            ? "Add the business and accountant contacts used by this workspace."
            : "A manager can add the business and accountant contacts for this workspace."}
        />
      ) : null}

      <CompanyProfileForm
        key={businessProfile.entityVersion}
        companyId={companyId}
        initial={companyFormInitial(businessProfile)}
        canEdit={canEditCompany}
      />
    </SettingsPageFrame>
  );
}
