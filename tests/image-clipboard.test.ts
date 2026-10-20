import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { copyImage } from "@/lib/imageClipboard";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({ desktop: true }));
vi.mock("@tauri-apps/api/image", () => ({ Image: { new: vi.fn() } }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeImage: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const close = vi.fn();
const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Image.new).mockResolvedValue({ close } as unknown as Image);
  vi.mocked(writeImage).mockResolvedValue();
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 2;
      naturalHeight = 1;
      onload?: () => void;
      set src(_src: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: pixels }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("copies image pixels through the native clipboard and releases the image resource", async () => {
  await copyImage("data:image/png;base64,AAAA");
  expect(Image.new).toHaveBeenCalledWith(new Uint8Array(pixels), 2, 1);
  expect(writeImage).toHaveBeenCalledWith({ close });
  expect(close).toHaveBeenCalledOnce();
  expect(toast.success).toHaveBeenCalledWith("已复制图片");
});
it("releases native resources when clipboard writing fails", async () => {
  vi.mocked(writeImage).mockRejectedValueOnce(new Error("clipboard busy"));
  await copyImage(async () => "data:image/png;base64,AAAA");
  expect(close).toHaveBeenCalledOnce();
  expect(toast.error).toHaveBeenCalledWith("复制图片失败");
  expect(toast.success).not.toHaveBeenCalled();
});
it("does not change the clipboard when the original image cannot be read", async () => {
  await copyImage(async () => {
    throw new Error("missing");
  });
  expect(writeImage).not.toHaveBeenCalled();
  expect(Image.new).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("复制图片失败");
});
