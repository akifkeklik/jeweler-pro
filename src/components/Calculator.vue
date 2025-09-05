<template>
  <v-container>
    <v-row justify="center">
      <v-col cols="12" md="8">
        <v-card elevation="10" class="pa-6 calc-card">
          <!-- Başlık -->
          <v-card-title class="calc-header">
            <v-icon left color="#1E3A8A">mdi-calculator-variant</v-icon> <!-- Lacivert -->
            Kuyumculuk Hesap Makinesi
          </v-card-title>
          <v-divider class="mb-4"></v-divider>

          <!-- Girdi Alanları -->
          <v-row>
            <v-col cols="12" md="6">
              <v-card class="input-card pa-3" outlined>
                <v-text-field
                    v-model.number="amount"
                    label="Miktar"
                    type="number"
                    min="0"
                    dense
                    outlined
                    hide-details
                    prepend-inner-icon="mdi-scale-balance"
                />
              </v-card>
            </v-col>

            <v-col cols="12" md="6">
              <v-card class="input-card pa-3" outlined>
                <v-select
                    v-model="selectedUnit"
                    :items="units"
                    :menu-props="{ offsetY: true }"
                    item-text="text"
                    item-value="value"
                    label="Birim Seç"
                    dense
                    outlined
                    hide-details
                    prepend-inner-icon="mdi-diamond-stone"
                />
              </v-card>
            </v-col>
          </v-row>

          <!-- Hesaplama Sonucu -->
          <v-card outlined class="pa-5 mt-4 result-card text-center">
            <div class="result-box">
              <div class="text-h6 font-weight-medium result-text">Sonuç</div>
              <div class="text-h5 font-weight-bold mt-2 result-text">
                {{ formattedResult }}
              </div>
            </div>
          </v-card>

          <!-- Tablo -->
          <v-card class="mt-6 table-card" outlined>
            <v-card-title class="text-subtitle-1 font-weight-bold result-text">
              Güncel Birim Fiyatları
            </v-card-title>
            <v-simple-table dense>
              <thead>
              <tr>
                <th>Birim</th>
                <th>Gram Karşılığı</th>
                <th>TL Fiyatı</th>
              </tr>
              </thead>
              <tbody>
              <tr v-for="u in units" :key="u.value">
                <td>{{ u.text }}</td>
                <td>{{ u.gram }} gr</td>
                <td>{{ (u.gram * pricePerGram).toLocaleString() }} ₺</td>
              </tr>
              </tbody>
            </v-simple-table>
          </v-card>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
export default {
  name: "Calculator",
  data() {
    return {
      amount: 1,
      selectedUnit: null,
      pricePerGram: 1000,
      units: [
        { text: "Gram Altın", value: "gram", gram: 1 },
        { text: "Çeyrek Altın", value: "ceyrek", gram: 1.75 },
        { text: "Yarım Altın", value: "yarim", gram: 3.5 },
        { text: "Tam Altın", value: "tam", gram: 7 },
        { text: "Ata Lira", value: "ata", gram: 7.216 },
      ],
    };
  },
  computed: {
    formattedResult() {
      if (!this.selectedUnit) return "Birim seçiniz";
      const unit = this.units.find((u) => u.value === this.selectedUnit);
      const totalGrams = this.amount * unit.gram;
      const totalPrice = totalGrams * this.pricePerGram;
      return `${this.amount} ${unit.text} ≈ ${totalGrams.toFixed(
          2
      )} gr | ${totalPrice.toLocaleString()} ₺`;
    },
  },
  watch: {
    amount(val) {
      if (val < 0) this.amount = 0;
    },
  },
};
</script>

<style scoped>

/* Başlık */
.calc-header {
  font-size: 1.2rem;
  font-weight: bold;
  color: black;
}
.result-text {
  color: black !important;
}

.v-simple-table th {
  font-weight: 600;
  color: #444;
}
.v-simple-table td {
  font-weight: 500;
  color: #333;
}
.v-simple-table tbody tr:hover {
  background-color: #fffbe6;
}
</style>
