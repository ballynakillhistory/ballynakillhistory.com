import PhotoSwipeLightbox from "https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.esm.min.js";

// GoatCounter loads async from the <head> and may be blocked, so every call is guarded
function track(path, title) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path, title, event: true });
  }
}

const fileName = (url) => decodeURIComponent(new URL(url, location.href).pathname.split("/").pop());

document.querySelectorAll(".map-gallery").forEach((gallery) => {
  gallery.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link) track("image: " + fileName(link.href), document.title);
  });

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

const singles = [...document.querySelectorAll("main figure.zoomable img")].filter(
  (img) => !img.closest("a") && !img.closest(".map-gallery")
);

if (singles.length) {
  const single = new PhotoSwipeLightbox({
    pswpModule: () =>
      import("https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js"),
  });
  single.init();

  singles.forEach((img) => {
    const open = () => {
      track("image: " + fileName(img.src), document.title);
      single.loadAndOpen(0, [
        { src: img.src, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt },
      ]);
    };
    img.style.cursor = "zoom-in";
    img.setAttribute("role", "button");
    img.setAttribute("tabindex", "0");
    img.setAttribute("aria-label", img.alt ? "Enlarge image: " + img.alt : "Enlarge image");
    img.addEventListener("click", open);
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}
