use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader, Limits};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Cursor, Read},
    path::Path,
};

const MAX_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ImagePreview {
    url: String,
    mime: String,
    size: usize,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ImageFile {
    content: String,
    revision: String,
    image: ImagePreview,
}

fn read(path: &Path, thumbnail: bool) -> Result<ImageFile, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("请选择图片文件".into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("图片超过 20 MB，请使用系统程序打开".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("图片超过 20 MB，请使用系统程序打开".into());
    }
    let revision = format!("{:x}", Sha256::digest(&bytes));
    let size = bytes.len();
    let mut content = String::new();
    let (mime, width, height) = if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"))
    {
        if size > 2 * 1024 * 1024 {
            return Err("SVG 超过 2 MB，请使用系统程序打开".into());
        }
        content = String::from_utf8(bytes.clone()).map_err(|_| "SVG 必须为 UTF-8 文本")?;
        let mut reader = quick_xml::Reader::from_str(&content);
        loop {
            match reader.read_event().map_err(|_| "SVG 格式无效")? {
                quick_xml::events::Event::Start(tag) | quick_xml::events::Event::Empty(tag) => {
                    if tag.local_name().as_ref() != "svg" {
                        return Err("文件不是 SVG 图片".into());
                    }
                    break;
                }
                quick_xml::events::Event::Eof | quick_xml::events::Event::DocType(_) => {
                    return Err("SVG 格式无效".into());
                }
                _ => {}
            }
        }
        // Render only as an <img> data URL: never insert SVG into the app DOM.
        ("image/svg+xml", None, None)
    } else {
        let format = image::guess_format(&bytes).map_err(|_| "不支持此图片格式")?;
        let mime = match format {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Gif => "image/gif",
            ImageFormat::WebP => "image/webp",
            ImageFormat::Bmp => "image/bmp",
            ImageFormat::Ico => "image/x-icon",
            _ => return Err("不支持此图片格式".into()),
        };
        let mut reader = ImageReader::with_format(Cursor::new(&bytes), format);
        let mut limits = Limits::default();
        limits.max_image_width = Some(10_000);
        limits.max_image_height = Some(10_000);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let decoded = reader
            .decode()
            .map_err(|_| "图片损坏或尺寸过大，请使用系统程序打开")?;
        let (width, height) = (Some(decoded.width()), Some(decoded.height()));
        if thumbnail {
            let mut output = Cursor::new(Vec::new());
            decoded
                .thumbnail(960, 640)
                .write_to(&mut output, ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            bytes = output.into_inner();
            ("image/png", width, height)
        } else {
            (mime, width, height)
        }
    };
    Ok(ImageFile {
        content,
        revision,
        image: ImagePreview {
            url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
            mime: mime.into(),
            size,
            width,
            height,
        },
    })
}

#[tauri::command]
pub async fn read_project_image(
    project: String,
    path: String,
    thumbnail: Option<bool>,
) -> Result<ImageFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read(
            &crate::files::checked_path(&project, &path)?,
            thumbnail.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_content_and_keeps_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.png");
        image::RgbaImage::new(20, 10).save(&path).unwrap();
        let preview = read(&path, false).unwrap();
        assert!(preview.content.is_empty());
        assert_eq!(preview.image.width, Some(20));
        assert_eq!(preview.image.height, Some(10));
        assert_eq!(
            preview.image.url,
            format!(
                "data:image/png;base64,{}",
                STANDARD.encode(std::fs::read(&path).unwrap())
            )
        );
        let thumb = read(&path, true).unwrap();
        assert_eq!(thumb.revision, preview.revision);
        std::fs::write(&path, b"not an image").unwrap();
        assert!(read(&path, false).is_err());
    }
    #[test]
    fn svg_keeps_source_and_never_embeds_html() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.svg");
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>"#;
        std::fs::write(&path, svg).unwrap();
        let preview = read(&path, false).unwrap();
        assert_eq!(preview.content, svg);
        assert!(preview.image.url.starts_with("data:image/svg+xml;base64,"));
        for invalid in ["<html>bad</html>", "<!DOCTYPE svg><svg/>", "not svg"] {
            std::fs::write(&path, invalid).unwrap();
            assert!(read(&path, false).is_err());
        }
    }
    #[test]
    fn bounds_reads_and_reuses_project_containment() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.png");
        File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        assert!(read(&path, false).unwrap_err().contains("20 MB"));
        let project = dir.path().to_str().unwrap();
        assert!(crate::files::checked_path(project, "../outside.png").is_err());
        assert!(crate::files::checked_path(project, "/outside.png").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&path, dir.path().join("link.png")).unwrap();
            assert!(crate::files::checked_path(project, "link.png").is_err());
        }
    }
}
