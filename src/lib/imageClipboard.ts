import { Image as NativeImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { desktop } from "./api";

async function imageCanvas(source: string | (() => Promise<string>)) {
  const src = typeof source === "function" ? await source() : source;
  const image = new window.Image();
  image.referrerPolicy = "no-referrer";
  if (/^https?:/i.test(src)) image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片无法读取"));
    image.src = src;
  });
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width * height > 32_000_000)
    throw new Error("图片尺寸过大");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法读取图片");
  context.drawImage(image, 0, 0);
  return { canvas, context, width, height };
}

/** Copy pixels, never the Markdown, filename, or thumbnail URL. */
export async function copyImage(source: string | (() => Promise<string>)) {
  try {
    if (desktop) {
      const { context, width, height } = await imageCanvas(source);
      const data = context.getImageData(0, 0, width, height);
      const native = await NativeImage.new(
        new Uint8Array(data.data),
        width,
        height,
      );
      try {
        await writeImage(native);
      } finally {
        await native.close();
      }
    } else {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
        throw new Error("当前环境不支持复制图片");
      // Start the clipboard write in the gesture, before image decoding completes.
      const png = imageCanvas(source).then(
        ({ canvas }) =>
          new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob ? resolve(blob) : reject(new Error("无法复制图片")),
              "image/png",
            ),
          ),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
    }
    toast.success("已复制图片");
  } catch {
    toast.error("复制图片失败");
  }
}
