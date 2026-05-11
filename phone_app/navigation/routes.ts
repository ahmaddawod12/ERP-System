export const ROUTES = {
  root: '/',
  login: '/Login',
  managerHome: '/ManagerHomepage',
  workerHome: '/WorkerHomepage',
  userHome: '/UserHomepage',
  basicHome: '/BasicHomepage',
  devInbox: '/DevInbox',
  settings: '/Settings',
  supportChat: '/SupportChat',
  workerJobs: '/Workerjob',
  userJobs: '/Userjob',
  manageJobs: '/ManageJobs',
  createJob: '/CreateJob',
  editJob: '/EditJob',
  fillJob: '/FillJob',
  jobMonitor: '/JobMonitor',
  workersMonitor: '/WorkersMonitor',
  workersUsers: '/WorkersUsers',
  inventory: '/inventory',
  companyInventory: '/CompanyInventory',
  clientBook: '/ClientBook',
  generalDocuments: '/GeneralDocuments',
  createDocument: '/CreateDocument',
  documentHistory: '/DocumentHistory',
  viewDocument: '/ViewDocument',
  generateTaxInvoice: '/GenerateTaxInvoice',
} as const;

export const HOME_ROUTES = [
  ROUTES.managerHome,
  ROUTES.userHome,
  ROUTES.workerHome,
  ROUTES.basicHome,
] as const;

export const NOTIFICATION_SCREEN_ROUTES = {
  Workerjob: ROUTES.workerJobs,
  ManageJobs: ROUTES.manageJobs,
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
