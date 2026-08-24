# -*- coding: utf-8 -*-
"""图片翻译后端：OCR 识别图片中的文字框（RapidOCR）
能力：
  - ocr_image：接收图片字节 → 输出 {width, height, boxes:[{box, text, score}]}
    box 为原图像素坐标 [x1, y1, x2, y2]（左上/右下）

依赖：rapidocr_onnxruntime（引擎复用 pdf.py 的加载逻辑）、opencv-python（解码与尺寸）
"""
import os
import tempfile

import cv2

from pdf import _ocr_engine


class ImgError(Exception):
    pass


def ocr_image(data, filename='image.png'):
    """识别图片中的文字。返回 {width, height, boxes}
    boxes: [{box: [x1,y1,x2,y2], text, score}]，坐标按输入图原始像素。
    格式由内容自动识别（opencv 解码），临时文件统一用 .png 后缀即可。
    """
    fd, tmp = tempfile.mkstemp(suffix='.png')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        img = cv2.imread(tmp)
        if img is None:
            raise ImgError('无法解码图片，请确认文件有效（支持 png / jpg / webp / bmp）')
        height, width = img.shape[:2]
        engine = _ocr_engine()
        result, _ = engine(tmp)
        boxes = []
        if result:
            for box, text, score in result:
                t = str(text).strip()
                if not t:
                    continue
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                boxes.append({
                    'box': [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
                    'text': t,
                    'score': round(float(score), 3),
                })
        return {'width': width, 'height': height, 'boxes': boxes}
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass