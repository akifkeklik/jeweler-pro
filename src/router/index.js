import Vue from 'vue';
import Router from 'vue-router';

const LoginPage = () => import(/* webpackChunkName: "login" */ "@/pages/LoginPage.vue");
const SalesPage = () => import(/* webpackChunkName: "sales" */ "@/pages/Sales.vue");
const ProductPage = () => import(/* webpackChunkName: "products" */ "@/pages/Products/ProductPage.vue");
const CustomerPage = () => import(/* webpackChunkName: "customers" */ "@/pages/Customers/CustomerPage.vue");
const ReportPage = () => import(/* webpackChunkName: "reports" */ "@/pages/Reports/ReportPage.vue");
const PricesPage = () => import(/* webpackChunkName: "prices" */ "@/pages/PricesPage.vue");
const DashboardPage = () => import(/* webpackChunkName: "dashboard" */ "@/pages/DashboardPage.vue");
const CalculatorPage = () => import(/* webpackChunkName: "calculator" */ "@/components/Calculator.vue");

Vue.use(Router);

const router = new Router({
  mode: 'history',
  routes: [
    { path: '/login', name: 'Login', component: LoginPage, meta: { public: true } },
    { path: '/sales', name: 'Sales', component: SalesPage, meta: { requiresAuth: true } },
    { path: '/products', name: 'Products', component: ProductPage, meta: { requiresAuth: true } },
    { path: '/customers', name: 'Customers', component: CustomerPage, meta: { requiresAuth: true } },
    { path: '/reports', name: 'Reports', component: ReportPage, meta: { requiresAuth: true } },
    { path: '/prices', name: 'PricesPage', component: PricesPage, meta: { requiresAuth: true } },
    { path: '/dashboard', name: 'Dashboard', component: DashboardPage, meta: { requiresAuth: true } },
    { path: '/calculator', name: 'Calculator', component: CalculatorPage, meta: { requiresAuth: true } },
    { path: '*', redirect: '/dashboard' },
  ],
});

router.beforeEach((to, from, next) => {
  const token = sessionStorage.getItem('jeweler_token');
  if (to.meta.public && token) return next('/dashboard');
  if (to.matched.some((record) => record.meta.requiresAuth) && !token) {
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }
  return next();
});

export default router;
