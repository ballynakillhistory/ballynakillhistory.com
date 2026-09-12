import PhotoSwipeLightbox from "https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.esm.min.js";

document.querySelectorAll(".map-gallery").forEach((gallery) => {
  gallery.querySelectorAll("a").forEach((link) => {
    const img = new Image();
    img.onload = () => {
      link.dataset.pswpWidth = img.naturalWidth;
      link.dataset.pswpHeight = img.naturalHeight;
    };
    img.src = link.href;
  });

  const lightbox = new PhotoSwipeLightbox({
    gallery,
    children: "a",
    pswpModule: () =>
      import("https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js"),
  });
  lightbox.init();
});
