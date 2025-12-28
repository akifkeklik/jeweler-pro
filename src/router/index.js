import Vue from 'vue';
import Router from 'vue-router';

// Sayfaları import et
// Lazy-loaded sayfalar
const SalesPage = () => import(/* webpackChunkName: "sales" */ "@/pages/Sales.vue");
const ProductPage = () => import(/* webpackChunkName: "products" */ "@/pages/Products/ProductPage.vue");
const CustomerPage = () => import(/* webpackChunkName: "customers" */ "@/pages/Customers/CustomerPage.vue");
const ReportPage = () => import(/* webpackChunkName: "reports" */ "@/pages/Reports/ReportPage.vue");
const PricesPage = () => import(/* webpackChunkName: "prices" */ "@/pages/PricesPage.vue");
const DashboardPage = () => import(/* webpackChunkName: "dashboard" */ "@/pages/DashboardPage.vue");
const CalculatorPage = () => import(/* webpackChunkName: "calculator" */ "@/components/Calculator.vue");

Vue.use(Router);

// 🔹 push ve replace metodlarını override et
const originalPush = Router.prototype.push;
Router.prototype.push = function push(location) {
    return originalPush.call(this, location).catch(err => err);
};

const originalReplace = Router.prototype.replace;
Router.prototype.replace = function replace(location) {
    return originalReplace.call(this, location).catch(err => err);
};

export default new Router({
    mode: "history",  // URL'yi temiz tutmak için history modunu kullan
    routes: [
        { path: "/sales", name: "Sales", component: SalesPage },
        { path: "/products", name: "Products", component: ProductPage },
        { path: "/customers", name: "Customers", component: CustomerPage },
        { path: "/reports", name: "Reports", component: ReportPage },
        { path: "/prices", name: "PricesPage", component: PricesPage },
        { path: "/dashboard", name: "Dashboard", component: DashboardPage },
        { path: "/calculator", name: "Calculator", component: CalculatorPage },
        // Varsayılan yönlendirme
        { path: "*", redirect: "/dashboard" }
    ]
});
