<template>
  <div class="chart-panel-card jp-card">
    <div class="panel-header">
      <div class="panel-title-wrap">
        <v-icon size="16" color="primary" class="mr-1">mdi-finance</v-icon>
        <span class="panel-title">{{ $t('reports.p0SatisTrendiGrafigi', { p0: periodLabel }) }}</span>
      </div>
      <span class="text-caption text-disabled tabular">
        {{ $t('reports.p0IslemKaydi', { p0: orders.length }) }}
      </span>
    </div>

    <div class="chart-container">
      <Bar
        v-if="chartData.datasets[0].data.length"
        :data="chartData"
        :options="chartOptions"
        :aria-label="chartSummary"
      />
      <div v-else class="empty-chart-state">
        <v-icon size="36" class="mb-2 jp-empty-icon">mdi-chart-bar</v-icon>
        <div class="text-caption text-disabled">{{ $t('reports.buDonemIcinGrafikVerisi') }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { Bar } from 'vue-chartjs';
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip, type ChartOptions, type TooltipItem } from 'chart.js';
import { money, t } from '@/i18n';
import { themeState } from '@/theme';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

interface ChartOrder { productName?: string; netTotal?: number | null; totalPrice?: number | null }

/** Bar chart of the period's first eight sales (Chart.js, the app's single chart library). */
export default defineComponent({
  name: 'SalesTrendChart',
  components: { Bar },
  props: {
    orders: { type: Array as PropType<ChartOrder[]>, default: () => [] },
    periodLabel: { type: String, default: '' },
  },
  computed: {
    labels(): string[] {
      return this.orders.slice(0, 8).map((o) => {
        const name = o.productName || t('reports.chartSale');
        return name.length > 12 ? `${name.substring(0, 12)}…` : name;
      });
    },
    chartData() {
      const data = this.orders.slice(0, 8).map((o) => Number(o.netTotal ?? o.totalPrice ?? 0) || 0);
      return {
        labels: this.labels,
        datasets: [{
          label: t('reports.chartSeries'),
          data,
          backgroundColor: themeState.chart[0] || '#c9a227',
          borderRadius: 4,
          maxBarThickness: 48,
        }],
      };
    },
    /** Text alternative of the chart for screen readers. */
    chartSummary(): string {
      const values = this.chartData.datasets[0].data;
      const items = this.labels.map((label, i) => `${label}: ${money(values[i])}`);
      return `${t('reports.p0SatisTrendiGrafigi', { p0: this.periodLabel })}. ${items.join(', ')}`;
    },
    chartOptions(): ChartOptions<'bar'> {
      // Colours come from the active palette; animation follows reduced motion.
      const isDark = themeState.mode === 'dark';
      const base = themeState.tokens?.base;
      const axis = base ? base.textMuted : (isDark ? '#a6a49f' : '#5d5950');
      const line = base ? base.border : (isDark ? '#2a2c32' : '#e1ddd4');
      const formatAmount = (val: string | number) => money(Number(val) || 0, 'TRY', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: themeState.reducedMotion ? false : { duration: 280 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx: TooltipItem<'bar'>) => money(Number(ctx.parsed.y) || 0) } },
        },
        scales: {
          x: { ticks: { color: axis, font: { size: 10 } }, grid: { display: false }, border: { color: line } },
          y: {
            ticks: { color: axis, font: { size: 10 }, callback: formatAmount },
            grid: { color: line },
            border: { dash: [3, 3], color: line },
          },
        },
      };
    },
  },
});
</script>

<style scoped>
.chart-panel-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 8px 12px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}
.panel-title-wrap {
  display: flex;
  align-items: center;
}
.panel-title {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
}
.chart-container {
  flex: 1;
  min-height: 0;
  position: relative;
  margin-top: 6px;
}
.empty-chart-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
