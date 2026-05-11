export type CompanyScope = {
  internalCompanyId: string;
  publicCompanyId: string;
};

export type RequesterContext = {
  role: string;
  membershipId: string | null;
  memberNo: number | null;
  accountType: string;
  isDev: boolean;
};

