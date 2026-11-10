import { createRouter, createWebHistory } from 'vue-router';
import { hasPermission, isAuthenticated, restoreSession, safeRedirectPath } from '@/services/authSession';

const LoginPage = () => import(/* webpackChunkName: "login" */ "@/pages/LoginPage.vue");
const ResetPasswordPage = () => import(/* webpackChunkName: "reset-password" */ "@/pages/ResetPasswordPage.vue");
const SalesPage = () => import(/* webpackChunkName: "sales" */ "@/pages/Sales.vue");
const ProductPage = () => import(/* webpackChunkName: "products" */ "@/pages/Products/ProductPage.vue");
const CustomerPage = () => import(/* webpackChunkName: "customers" */ "@/pages/Customers/CustomerPage.vue");
const ReportPage = () => import(/* webpackChunkName: "reports" */ "@/pages/Reports/ReportPage.vue");
const PricesPage = () => import(/* webpackChunkName: "prices" */ "@/pages/PricesPage.vue");
const DashboardPage = () => import(/* webpackChunkName: "dashboard" */ "@/pages/DashboardPage.vue");
const CalculatorPage = () => import(/* webpackChunkName: "calculator" */ "@/components/Calculator.vue");
const SettingsPage = () => import(/* webpackChunkName: "settings" */ "@/pages/SettingsPage.vue");
const FinancePage = () => import(/* webpackChunkName: "finance" */ "@/pages/FinancePage.vue");
const TransfersPage = () => import(/* webpackChunkName: "transfers" */ "@/pages/TransfersPage.vue");
const PosPage = () => import(/* webpackChunkName: "pos" */ "@/pages/PosPage.vue");

// meta.permission mirrors the permission the backend enforces for the page's
// primary data endpoint (see backend/middleware/authorization.js).
export const routes = [
  { path: '/login', name: 'Login', component: LoginPage, meta: { public: true } },
  { path: '/reset-password', name: 'ResetPassword', component: ResetPasswordPage, meta: { public: true, allowAuthenticated: true } },
  { path: '/dashboard', name: 'Dashboard', component: DashboardPage, meta: { requiresAuth: true, permission: 'dashboard:read' } },
  { path: '/prices', name: 'PricesPage', component: PricesPage, meta: { requiresAuth: true, permission: 'prices:read' } },
  { path: '/sales', name: 'Sales', component: SalesPage, meta: { requiresAuth: true, permission: 'sales:read' } },
  { path: '/products', name: 'Products', component: ProductPage, meta: { requiresAuth: true, permission: 'catalog:read' } },
  { path: '/customers', name: 'Customers', component: CustomerPage, meta: { requiresAuth: true, permission: 'customers:read' } },
  { path: '/reports', name: 'Reports', component: ReportPage, meta: { requiresAuth: true, permission: 'reports:read' } },
  { path: '/finance', name: 'Finance', component: FinancePage, meta: { requiresAuth: true, permission: 'purchases:read' } },
  { path: '/transfers', name: 'Transfers', component: TransfersPage, meta: { requiresAuth: true, permission: 'transfers:read' } },
  { path: '/pos', name: 'Pos', component: PosPage, meta: { requiresAuth: true, permission: 'pos:read' } },
  { path: '/calculator', name: 'Calculator', component: CalculatorPage, meta: { requiresAuth: true } },
  { path: '/settings', name: 'Settings', component: SettingsPage, meta: { requiresAuth: true } },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

function firstPermittedPath() {
  const match = routes.find((r) => r.meta?.requiresAuth && (!r.meta.permission || hasPermission(r.meta.permission)));
  return match ? match.path : '/settings';
}

router.beforeEach(async (to) => {
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth);

  // Silent restore from the HttpOnly refresh cookie (reload / new tab / remember me).
  if (!isAuthenticated() && (requiresAuth || to.name === 'Login')) {
    await restoreSession();
  }

  if (to.name === 'Login' && isAuthenticated()) {
    return safeRedirectPath(to.query.redirect);
  }

  if (requiresAuth && !isAuthenticated()) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  const permission = to.meta.permission;
  if (requiresAuth && permission && !hasPermission(permission)) {
    const fallback = firstPermittedPath();
    return fallback === to.path ? '/settings' : fallback;
  }

  return true;
});

export default router;
