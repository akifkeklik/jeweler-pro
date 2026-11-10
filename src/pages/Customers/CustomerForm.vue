<template>
  <form class="customer-form-container" @submit.prevent="kaydet">
    <div class="form-grid">
      <div class="form-col-span-2">
        <label class="form-label" for="customerform-f1">{{ $t('customers.adSoyadTicariUnvan') }}</label>
        <input id="customerform-f1"
          v-model.trim="musteri.name"
          type="text"
          :placeholder="$t('customers.ornAhmetYilmazVeyaAltin')"
          class="form-input-control"
          required
        />
      </div>

      <div>
        <label class="form-label" for="customerform-f2">{{ $t('customers.telefonNumarasi') }}</label>
        <input id="customerform-f2"
          v-model.trim="musteri.phone"
          type="tel"
          :placeholder="$t('customers.n05xxXxxXxXx')"
          class="form-input-control tabular"
          required
        />
      </div>

      <div>
        <label class="form-label" for="customerform-f3">{{ $t('customers.ePostaAdresi') }}</label>
        <input id="customerform-f3"
          v-model.trim="musteri.email"
          type="email"
          :placeholder="$t('customers.musteriOrnekCom')"
          class="form-input-control"
        />
      </div>

      <div>
        <label class="form-label" for="customerform-f4">{{ $t('customers.musteriTuru') }}</label>
        <select id="customerform-f4" v-model="musteri.customerType" class="form-select-control">
          <option value="bireysel">{{ $t('customers.bireyselMusteri') }}</option>
          <option value="kurumsal">{{ $t('customers.kurumsalToptan2') }}</option>
        </select>
      </div>

      <div class="form-col-span-2">
        <label class="form-label" for="customerform-f5">{{ $t('customers.adresLokasyon') }}</label>
        <textarea id="customerform-f5"
          v-model.trim="musteri.address"
          rows="2"
          :placeholder="$t('customers.ikametgahVeyaIsletmeAcikAdresi')"
          class="form-textarea-control"
        ></textarea>
      </div>
    </div>

    <div class="form-actions mt-4">
      <v-spacer></v-spacer>
      <v-btn
        size="small"
        class="jp-secondary mr-2"
        type="button"
        @click="$emit('close')"
      >
        {{ $t('common.cancel') }}
      </v-btn>
      <v-btn
        size="small"
        class="jp-primary"
        type="submit"
        :loading="saving"
        :disabled="!isValid"
      >
        <v-icon start size="14">mdi-check</v-icon>
        {{ $t('common.save') }}
      </v-btn>
    </div>
  </form>
</template>

<script>
import apiService from "@/services/api";

export default {
  name: "CustomerForm",
  props: {
    musteriProp: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      saving: false,
      musteri: {
        name: "",
        phone: "",
        email: "",
        address: "",
        customerType: "bireysel"
      }
    };
  },
  computed: {
    isValid() {
      return Boolean(this.musteri.name) && Boolean(this.musteri.phone);
    }
  },
  watch: {
    musteriProp: {
      handler(val) {
        if (val) {
          this.musteri = { ...val };
        } else {
          this.resetForm();
        }
      },
      deep: true,
      immediate: true
    }
  },
  methods: {
    async kaydet() {
      if (!this.isValid) return;
      this.saving = true;
      try {
        let res;
        if (this.musteri._id) {
          res = await apiService.put("/api/customers/" + this.musteri._id, this.musteri);
        } else {
          res = await apiService.post("/api/customers", this.musteri);
        }
        this.$emit("ekle", res);
        this.$emit("close");
        this.resetForm();
      } catch (err) {
        console.error("Customer save failed:", err);
      } finally {
        this.saving = false;
      }
    },
    resetForm() {
      this.musteri = {
        name: "",
        phone: "",
        email: "",
        address: "",
        customerType: "bireysel"
      };
    }
  }
};
</script>

<style scoped>
.customer-form-container {
  display: flex;
  flex-direction: column;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-col-span-2 {
  grid-column: span 2;
}

.form-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--jp-text-muted);
  margin-bottom: 4px;
}

.form-input-control,
.form-select-control {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 11px;
  outline: none;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard);
}

.form-input-control:focus,
.form-select-control:focus {
  border-color: var(--jp-gold);
}

.form-textarea-control {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 11px;
  outline: none;
  resize: vertical;
}
.form-textarea-control:focus {
  border-color: var(--jp-gold);
}

.form-actions {
  display: flex;
  align-items: center;
}
</style>
