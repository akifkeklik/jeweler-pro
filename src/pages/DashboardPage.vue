<template>
  <div class="dashboard">
    <div class="card-grid">
      <div
          v-for="(card, index) in cards"
          :key="index"
          class="dashboard-card"
          :style="{ background: card.gradient }"
          @click="goToPage(card.path)"
      >
        <div class="card-content">
          <v-icon class="dashboard-icon">{{ card.icon }}</v-icon>
          <span class="dashboard-title">{{ card.title }}</span>
          <small class="dashboard-subtitle">{{ card.subtitle }}</small>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "Dashboard",
  data() {
    return {
      cards: [
        { title: "Değerler", subtitle: "Altın, gümüş ve taş fiyatları", icon: "mdi-diamond-stone", path: "/prices", gradient: "linear-gradient(135deg, #FFD700, #FFECB3)" },
        { title: "Satışlar", subtitle: "Satış ve fatura işlemleri", icon: "mdi-cart-outline", path: "/sales", gradient: "linear-gradient(135deg, #81D4FA, #4FC3F7)" },
        { title: "Ürünler", subtitle: "Stok yönetimi", icon: "mdi-cube-outline", path: "/products", gradient: "linear-gradient(135deg, #A5D6A7, #66BB6A)" },
        { title: "Müşteriler", subtitle: "Müşteri bilgileri ve ilişkiler", icon: "mdi-account-group", path: "/customers", gradient: "linear-gradient(135deg, #F48FB1, #EC407A)" },
        { title: "Raporlar", subtitle: "İş analitiği ve raporlar", icon: "mdi-chart-line", path: "/reports", gradient: "linear-gradient(135deg, #B39DDB, #7E57C2)" },
        { title: "Hesap Makinesi", subtitle: "Gram Hesabı", icon: "mdi-calculator", path: "/calculator", gradient: "linear-gradient(135deg, #CFD8DC, #90A4AE)" },
      ],
    };
  },
  methods: {
    goToPage(path) {
      this.$router.push(path);
    },
  },
};
</script>

<style scoped>
.dashboard {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100%;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px; /* Increased gap for more spacing */
  width: 100%;
  max-width: 1200px; /* Increased max-width for larger grid */
}

.dashboard-card {
  border-radius: 16px;
  height: 220px; /* Increased height of the cards */
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  text-align: center;
  color: #1a1a1a;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  transition: transform 0.4s ease, box-shadow 0.4s ease, filter 0.4s ease;
  padding: 15px; /* Added padding to balance content */
}

.dashboard-card:hover {
  transform: translateY(-6px) scale(1.05);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);
  filter: brightness(1.1);
}

.card-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%; /* Ensure content fills the full height of the card */
  text-align: center; /* Ensures that text is aligned to center */
}

.dashboard-icon {
  font-size: 3rem; /* Increased icon size */
  margin-bottom: 10px; /* Increased space between icon and text */
}

.dashboard-title {
  font-size: 1.5rem; /* Increased title font size */
  font-weight: 600;
  margin-bottom: 5px; /* Added space below title */
}

.dashboard-subtitle {
  font-size: 1rem; /* Increased subtitle font size */
  color: #333;
}
</style>
