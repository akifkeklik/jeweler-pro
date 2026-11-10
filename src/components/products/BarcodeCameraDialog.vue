<template>
  <v-dialog v-model="open" max-width="500px">
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="info" class="mr-2">mdi-camera</v-icon>
        {{ $t('products.kameraIleBarkodTara') }}
      </v-card-title>
      <v-card-text>
        <div class="camera-stream-wrap">
          <video ref="video" autoplay playsinline class="camera-video" :aria-label="$t('products.kameraIleBarkodTara')"></video>
          <div class="scanner-laser" aria-hidden="true"></div>
        </div>
        <p v-if="unsupported" class="text-caption text-center mt-2" role="alert">
          {{ $t('products.kameraDesteklenmiyor') }}
        </p>
        <p v-else class="text-caption text-center text-disabled mt-2">
          {{ $t('products.barkoduKameraninGorusAlaninaHizalayin') }}
        </p>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('common.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

/** Minimal shape of the (not yet standard-typed) BarcodeDetector API. */
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'code_39', 'qr_code'];

/**
 * Camera scanning with the browser's BarcodeDetector (Chrome, Edge,
 * Android). Where it is missing the dialog says so instead of pretending to
 * scan; USB/Bluetooth scanners work everywhere (they type the code).
 * Emits `detected` with the first code read and closes itself.
 */
export default defineComponent({
  name: 'BarcodeCameraDialog',
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'detected'],
  data: () => ({
    unsupported: false,
    stream: null as MediaStream | null,
    detector: null as BarcodeDetectorLike | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (value) this.$nextTick(() => this.start());
      else this.stop();
    },
  },
  beforeUnmount() {
    this.stop();
  },
  methods: {
    async start() {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      this.unsupported = !Detector || !navigator.mediaDevices?.getUserMedia;
      if (!Detector || this.unsupported) return;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = this.$refs.video as HTMLVideoElement | undefined;
        if (video) video.srcObject = this.stream;
        this.detector = new Detector({ formats: FORMATS });
        this.scan();
      } catch (error) {
        console.warn('Camera access failed:', error);
        this.unsupported = true;
      }
    },
    async scan() {
      const video = this.$refs.video as HTMLVideoElement | undefined;
      if (!this.modelValue || !this.detector || !video) return;
      try {
        const code = (await this.detector.detect(video))[0]?.rawValue;
        if (code) {
          this.$emit('detected', code);
          this.open = false;
          return;
        }
      } catch {
        // The video may not be ready yet; try again on the next tick.
      }
      this.timer = setTimeout(() => this.scan(), 250);
    },
    stop() {
      clearTimeout(this.timer);
      this.detector = null;
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>

<style scoped>
.camera-stream-wrap {
  position: relative;
  width: 100%;
  height: 240px;
  background: #000;
  border-radius: var(--jp-radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.camera-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scanner-laser {
  position: absolute;
  top: 50%;
  left: 10%;
  width: 80%;
  height: 2px;
  background: var(--jp-danger);
  box-shadow: 0 0 8px var(--jp-danger);
  animation: scan 2s infinite ease-in-out;
}
@keyframes scan {
  0%, 100% { transform: translateY(-40px); }
  50% { transform: translateY(40px); }
}
@media (prefers-reduced-motion: reduce) {
  .scanner-laser { animation: none; }
}
</style>
