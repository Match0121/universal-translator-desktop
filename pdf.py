# -*- coding: utf-8 -*-
"""PDF 翻译后端（文本型 PDF P3）
能力：
  - extract_pdf：解析 PDF → 判定是否有文字层 → 提取段落文本
  - export_translated：原文段落 + 译文 → 生成 docx / md / 重排 PDF

依赖：pymupdf（import pymupdf）、python-docx（import docx）
"""
import io
import os

import pymupdf
from docx import Document
from docx.shared import Pt

# 文字层判定阈值：整 PDF 可提取字符数 > 50 视为文本型
TEXT_TYPE_THRESHOLD = 50


class PdfError(Exception):
    pass


def extract_pdf(data):
    """解析 PDF 字节，返回 {text_type, total_chars, paragraphs}
    paragraphs: [{seq, original}]（非空且可翻译的段落，模拟 plain 行）
    """
    try:
        doc = pymupdf.open(stream=data, filetype='pdf')
    except Exception as e:
        raise PdfError('无法解析 PDF: %s' % e)
    try:
        paras = []
        seq = 0
        total_chars = 0
        for page in doc:
            text = page.get_text('text')
            total_chars += len(text)
            for line in text.splitlines():
                t = line.strip()
                if not t or len(t) > 800:
                    continue
                if t.isdigit() or all(ch in ' .,%+-*/=<>:;|!?()[]{}"\'`~^#$@&' for ch in t):
                    continue
                paras.append({'seq': seq, 'original': t})
                seq += 1
        return {
            'text_type': total_chars > TEXT_TYPE_THRESHOLD,
            'total_chars': total_chars,
            'paragraphs': paras,
            'page_count': doc.page_count,
        }
    finally:
        doc.close()


def export_translated(original_paras, translated_paras, fmt):
    """按 fmt 生成译文文档，返回 (bytes, filename, mime)
    original_paras: [{seq|idx, original}]；translated_paras: [{idx, translated}]
    fmt: 'docx' | 'md' | 'pdf'
    """
    # 合并：按出现序，译文取 translated 的值（缺失则用原文）
    by_idx = {}
    for i, p in enumerate(original_paras):
        by_idx[i] = p.get('original', '')
    for tp in translated_paras:
        idx = tp.get('seq', tp.get('idx', 0))
        if tp.get('translated'):
            by_idx[idx] = tp['translated']
    ordered = [by_idx[i] for i in sorted(by_idx)]

    if fmt == 'md':
        text = '# 译文文档\n\n' + '\n\n'.join(ordered) + '\n'
        return text.encode('utf-8'), 'translated.md', 'text/markdown'

    if fmt == 'docx':
        wd = Document()
        wd.add_heading('译文文档', 0)
        for line in ordered:
            para = wd.add_paragraph(line)
            # 默认字体（正文小五→合适字号）
            for run in para.runs:
                run.font.size = Pt(11)
        buf = io.BytesIO()
        wd.save(buf)
        return buf.getvalue(), 'translated.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if fmt == 'pdf':
        out = pymupdf.open()
        pg = out.new_page()
        y = 60
        line_h = 16
        pg.insert_text((60, y), '译文文档', fontsize=16, fontname='china-s')
        y += 30
        for line in ordered:
            if y > pg.rect.height - 50:
                pg = out.new_page()
                y = 60
            pg.insert_textbox(pymupdf.Rect(60, y, pg.rect.width - 60, y + line_h), line,
                              fontsize=11, fontname='china-s', align=0)
            y += line_h + 3
        buf = io.BytesIO()
        out.save(buf)
        out.close()
        return buf.getvalue(), 'translated.pdf', 'application/pdf'

    raise PdfError('不支持的导出格式: ' + fmt)