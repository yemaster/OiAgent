import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { call } from "@/lib/api";
import { conversationImage } from "@/lib/conversationImages";
import { ConversationImage } from "@/components/workspace/ConversationImage";
import { Transcript } from "@/components/workspace/Transcript";
import { FileEditor } from "@/pages/FileEditor";
import { useFiles } from "@/hooks/useFiles";
import { buildTranscript } from "@/lib/transcript";
import { demoSnapshot } from "@/lib/demo";
import type { OpenFile } from "@/lib/files";
import { ImageEditorContext } from "@/lib/imageEditor";
import { ProjectImageDialog } from "@/components/workspace/ImageDialog";
import { copyImage } from "@/lib/imageClipboard";
vi.mock("@/lib/imageClipboard", () => ({ copyImage: vi.fn() }));

vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
vi.mock("@/lib/monaco", () => ({}));
vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="text-editor" />,
  DiffEditor: () => <div data-testid="diff-editor" />,
}));
const image = {
  url: "data:image/png;base64,AAAA",
  mime: "image/png",
  size: 20,
  width: 20,
  height: 10,
};
const file: OpenFile = {
  id: "image",
  project: "/repo",
  path: "a.png",
  mode: "edit",
  content: "",
  saved: "",
  revision: "1",
  image,
  loading: false,
  saving: false,
};
beforeEach(() => {
  vi.mocked(call)
    .mockReset()
    .mockResolvedValue({ content: "", revision: "1", image });
});

it.each([
  ["assets/a%20b.png", "/repo", "assets/a b.png"],
  ["file:///repo/a%20b.png", "/repo", "a b.png"],
  ["/repo/a.png", "/repo", "a.png"],
  ["C:\\repo\\a.png", "C:\\repo", "a.png"],
  ["file:///C:/repo/a.png", "C:\\repo", "a.png"],
])("resolves image reference %s", (src, project, path) => {
  expect(conversationImage(src, project)).toMatchObject({ kind: "file", path });
});
it.each([
  "../private.png",
  "/other/a.png",
  "javascript:alert(1)",
  "data:text/html,hello",
  "https://user:password@example.com/a.png",
])("rejects image reference %s", (src) => {
  expect(conversationImage(src, "/repo")).toBeUndefined();
});

it("renders Markdown images through the scoped reader and opens the full image on click", async () => {
  render(
    <Transcript
      task={{ ...demoSnapshot.tasks[0], project: "/repo" }}
      childTasks={[]}
      onOpen={vi.fn()}
      items={buildTranscript([
        {
          role: "assistant",
          text: "![效果图](assets/a%20b.png)",
          timestamp: "now",
        },
      ])}
    />,
  );
  const thumbnail = await screen.findByRole("button", {
    name: "放大图片 效果图",
  });
  expect(thumbnail).toHaveAttribute("src", image.url);
  expect(call).toHaveBeenCalledWith("read_project_image", {
    project: "/repo",
    path: "assets/a b.png",
    thumbnail: true,
  });
  await userEvent.click(thumbnail);
  expect(await screen.findByRole("dialog", { name: "效果图" })).toBeVisible();
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("read_project_image", {
      project: "/repo",
      path: "assets/a b.png",
    }),
  );
  expect(await screen.findByRole("img", { name: "效果图" })).toHaveAttribute(
    "src",
    image.url,
  );
});
it("renders an encoded Windows image path emitted by Markdown", async () => {
  render(
    <Transcript
      task={{ ...demoSnapshot.tasks[0], project: "E:\\Works\\Project2" }}
      childTasks={[]}
      onOpen={vi.fn()}
      items={buildTranscript([
        {
          role: "assistant",
          text: "![界面](E:\\Works\\Project2\\screen.png)",
          timestamp: "now",
        },
      ])}
    />,
  );
  await screen.findByRole("button", { name: "放大图片 界面" });
  expect(call).toHaveBeenCalledWith("read_project_image", {
    project: "E:\\Works\\Project2",
    path: "screen.png",
    thumbnail: true,
  });
});
it("does not load network images before explicit action and never reads remote task paths locally", async () => {
  const view = render(
    <ConversationImage src="https://example.com/a.png" project="/repo" />,
  );
  expect(
    screen.queryByRole("button", { name: /放大图片/ }),
  ).not.toBeInTheDocument();
  expect(call).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "加载外部图片 · example.com" }),
  );
  expect(
    await screen.findByRole("button", { name: /放大图片/ }),
  ).toHaveAttribute("referrerpolicy", "no-referrer");
  view.unmount();
  render(<ConversationImage src="/repo/a.png" project="/repo" remote />);
  expect(screen.getByText(/图片位于执行设备/)).toBeVisible();
  expect(call).not.toHaveBeenCalled();
});
it("loads images from known attachment snapshots without granting access to other external paths", async () => {
  const attachment = {
    id: "snapshot",
    name: "a.png",
    path: "/app/attachments/snapshot/a.png",
    mime: "image/png",
    size: 4,
    digest: "x",
  };
  expect(conversationImage(attachment.path, "/repo")).toBeUndefined();
  vi.mocked(call).mockResolvedValue(image.url);
  render(
    <ConversationImage
      src={attachment.path}
      project="/repo"
      attachments={[attachment]}
    />,
  );
  await screen.findByRole("button", { name: /放大图片/ });
  expect(call).toHaveBeenCalledWith("read_attachment", {
    id: "snapshot",
    thumbnail: true,
  });
});
it("keeps raster previews read-only across open, save, reload and restore", async () => {
  const { result } = renderHook(() => useFiles());
  await act(() => result.current.open("/repo", "a.png"));
  expect(result.current.files).toHaveLength(0);
  expect(result.current.imagePreview).toEqual({
    project: "/repo",
    path: "a.png",
  });
  expect(call).not.toHaveBeenCalled();
  await act(() => result.current.openInEditor("/repo", "a.png"));
  expect(result.current.active?.image).toEqual(image);
  expect(call).toHaveBeenCalledWith("read_project_image", {
    project: "/repo",
    path: "a.png",
  });
  await act(() => result.current.save(result.current.active!.id));
  expect(
    vi.mocked(call).mock.calls.some(([name]) => name === "save_project_file"),
  ).toBe(false);
  vi.mocked(call).mockResolvedValue({
    content: "",
    revision: "2",
    image: { ...image, url: "data:image/png;base64,BBBB" },
  });
  await act(() => result.current.reload(result.current.active!.id));
  expect(result.current.active?.revision).toBe("2");
  const restored = renderHook(() =>
    useFiles(
      [{ id: "restored", project: "/repo", path: "a.png", mode: "edit" }],
      "restored",
    ),
  );
  await waitFor(() =>
    expect(restored.result.current.active?.image?.url).toContain("BBBB"),
  );
});
it("shows the image in the editor and preserves SVG source editing", async () => {
  const props = {
    onChange: vi.fn(),
    onSave: vi.fn(),
    onReload: vi.fn(),
    onResolve: vi.fn(),
    onOpen: vi.fn(),
  };
  const view = render(<FileEditor file={file} {...props} />);
  expect(screen.getByRole("img", { name: "a.png" })).toHaveAttribute(
    "src",
    image.url,
  );
  expect(screen.queryByTestId("text-editor")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "保存" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <FileEditor
      file={{ ...file, path: "a.svg", image: undefined, content: "<svg/>" }}
      {...props}
    />,
  );
  expect(screen.getByRole("img", { name: "a.svg" })).toHaveAttribute(
    "src",
    "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
  );
  await userEvent.click(screen.getByRole("button", { name: "源码" }));
  expect(screen.getByTestId("text-editor")).toBeVisible();
});
it("keeps system open and reveal actions enabled when the editor cannot decode a binary file", async () => {
  render(
    <FileEditor
      file={{
        ...file,
        path: "archive.zip",
        image: undefined,
        error: "此文件是二进制或非 UTF-8 文件，暂不支持编辑",
      }}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onReload={vi.fn()}
      onResolve={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  const reveal = screen.getByRole("button", { name: "在系统文件管理器中显示" });
  expect(reveal).toBeEnabled();
  await userEvent.click(reveal);
  expect(call).toHaveBeenCalledWith("system_file_action", {
    project: "/repo",
    path: "archive.zip",
    action: "reveal",
  });
  await userEvent.click(
    screen.getByRole("button", { name: "使用默认程序打开" }),
  );
  expect(call).toHaveBeenCalledWith("system_file_action", {
    project: "/repo",
    path: "archive.zip",
    action: "open",
  });
});
it("shows a retry action for missing images instead of a broken-image icon", async () => {
  vi.mocked(call).mockRejectedValueOnce("文件不存在");
  render(<ConversationImage src="missing.png" project="/repo" />);
  expect(await screen.findByText(/无法显示/)).toBeVisible();
  vi.mocked(call).mockResolvedValue({ content: "", revision: "1", image });
  await userEvent.click(screen.getByRole("button", { name: "重试" }));
  const shown = await screen.findByRole("button", { name: /放大图片/ });
  fireEvent.error(shown);
  expect(screen.getByText(/无法显示/)).toBeVisible();
});

it("keeps a project image in a small preview until the editor link is selected", async () => {
  const openEditor = vi.fn();
  const onClose = vi.fn();
  render(
    <ImageEditorContext.Provider value={openEditor}>
      <ProjectImageDialog
        project="/repo"
        path="assets/a.png"
        onClose={onClose}
      />
    </ImageEditorContext.Provider>,
  );
  expect(await screen.findByRole("img", { name: "a.png" })).toHaveAttribute(
    "src",
    image.url,
  );
  expect(openEditor).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "在编辑器中打开" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(openEditor).toHaveBeenCalledWith("/repo", "assets/a.png");
});

it("copies the full conversation image from its own menu and exposes an editor link", async () => {
  const openEditor = vi.fn();
  render(
    <ImageEditorContext.Provider value={openEditor}>
      <ConversationImage src="a.png" project="/repo" />
    </ImageEditorContext.Provider>,
  );
  const thumbnail = await screen.findByRole("button", {
    name: "放大图片 a.png",
  });
  fireEvent.contextMenu(thumbnail);
  await userEvent.click(screen.getByRole("menuitem", { name: "复制图片" }));
  const original = vi.mocked(copyImage).mock.calls.at(-1)![0];
  expect(typeof original).toBe("function");
  if (typeof original === "function") expect(await original()).toBe(image.url);
  expect(call).toHaveBeenLastCalledWith("read_project_image", {
    project: "/repo",
    path: "a.png",
  });
  await userEvent.click(thumbnail);
  await userEvent.click(
    await screen.findByRole("button", { name: "在编辑器中打开" }),
  );
  expect(openEditor).toHaveBeenCalledWith("/repo", "a.png");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
