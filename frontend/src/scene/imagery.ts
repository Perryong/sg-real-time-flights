import { UrlTemplateImageryProvider, type Request } from "cesium";
// Transform only the map imagery; aircraft/source colors retain their meaning.
export class DarkMapProvider extends UrlTemplateImageryProvider {
  requestImage(x: number, y: number, level: number, request?: Request) {
    const result = super.requestImage(x, y, level, request);
    if (!result) return undefined;
    return result.then((image) => {
      if (
        !(
          image instanceof HTMLImageElement ||
          image instanceof HTMLCanvasElement ||
          image instanceof ImageBitmap
        )
      )
        return image;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return image;
      // Cesium image bitmaps are already Y-flipped for WebGL; canvas uploads flip again.
      if (image instanceof ImageBitmap) {
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);
      }
      ctx.filter = "invert(1) grayscale(1) brightness(0.7)";
      ctx.drawImage(image, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = "#183846";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas;
    });
  }
}
