<template>
  <v-form ref="form" v-model="valid">
    <v-text-field
        v-model="musteri.name"
        label="Ad"
        outlined
        dense
        :rules="[v => !!v || 'Ad gerekli']"
    ></v-text-field>

    <v-text-field
        v-model="musteri.phone"
        label="Telefon"
        outlined
        dense
        prepend-icon="mdi-phone"
        :rules="[v => !!v || 'Telefon gerekli']"
    ></v-text-field>

    <v-text-field
        v-model="musteri.email"
        label="E-posta"
        outlined
        dense
        prepend-icon="mdi-email"
        :rules="[v => !!v || 'E-posta gerekli']"
    ></v-text-field>

    <v-text-field
        v-model="musteri.address"
        label="Adres"
        outlined
        dense
    ></v-text-field>

    <v-select
        :menu-props="{offsetY:true}"
        v-model="musteri.customerType"
        label="Tür"
        :items="['bireysel','kurumsal']"
        outlined
        dense
    ></v-select>

    <v-card-actions class="justify-end">
      <v-btn text color="grey" @click="$emit('close')">İptal</v-btn>
      <v-btn color="primary" :disabled="!valid" @click="kaydet">
        <v-icon left>mdi-content-save</v-icon> Kaydet
      </v-btn>
    </v-card-actions>
  </v-form>
</template>

<script>
import axios from "axios";

export default {
  name: "CustomerForm",
  props: {
    musteriProp: { type: Object, default: null } // düzenleme için prop
  },
  data() {
    return {
      valid: false,
      musteri: this.musteriProp
          ? { ...this.musteriProp }
          : {
            name: "",
            phone: "",
            email: "",
            address: "",
            customerType: "bireysel"
          }
    };
  },
  methods: {
    async kaydet() {
      if (this.$refs.form.validate()) {
        try {
          let res;
          if (this.musteri._id) {
            // Düzenleme
            res = await axios.put(
                `http://localhost:5000/api/customers/${this.musteri._id}`,
                this.musteri
            );
          } else {
            // Yeni ekleme
            res = await axios.post(
                "http://localhost:5000/api/customers",
                this.musteri
            );
          }
          this.$emit("ekle", res.data); // parent'a haber ver
          this.$emit("close");
          this.resetForm();
        } catch (err) {
          console.error("Müşteri kaydedilemedi:", err.response?.data || err);
        }
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
      this.$refs.form.resetValidation();
    }
  },
  watch: {
    musteriProp: {
      handler(val) {
        this.musteri = val
            ? { ...val }
            : {
              name: "",
              phone: "",
              email: "",
              address: "",
              customerType: "bireysel"
            };
      },
      deep: true,
      immediate: true
    }
  }
};
</script>
