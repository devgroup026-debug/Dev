// Shared helpers (dashboard, background, content script)
var DEVWA = (typeof DEVWA !== 'undefined') ? DEVWA : {
  buildUrl(job, item) {
    let url = 'https://web.whatsapp.com/send?phone=' + item.phone;
    // Text-only message: URL se pre-fill. Image ho to caption paste hota hai.
    const files = Array.isArray(item.files) ? item.files : (job.images || []);
    if (!files.length && item.msg) {
      url += '&text=' + encodeURIComponent(item.msg);
    }
    return url;
  },
  today() {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  }
};
