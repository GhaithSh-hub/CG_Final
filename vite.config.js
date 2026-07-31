import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      // ملفات النماذج ثابتة ولا تحتاج مراقبة hot-reload؛ استثناؤها يتفادى
      // انهيار Vite عند قفل OneDrive لملف كبير أثناء مزامنته (خطأ EBUSY)
      ignored: ['**/public/models/**'],
    },
  },
});
