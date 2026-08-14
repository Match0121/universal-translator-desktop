#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xp3 解包 / 封包（吉里吉里 KiriKiri 引擎资源包，无加密版）

格式参考 krkrz 开源 SDK（GPL）：
  头部:  8 字节 magic 'XP3\\r\\n\\x1a\\n' + 4 字节版本 + 8 字节索引偏移 + 8 字节索引大小
         （版本 & 0x10000 时在索引大小后还有 8 字节校验和）
  索引段: 4 字节文件数；每条: 2 字节文件名长度 + UTF-16LE 文件名(含\\0) +
         4 字节段数 + 每段 24 字节(偏移8/原大小8/压缩大小8) + 4 字节标志(bit0=zlib压缩)
         （版本 & 0x10000 时每条记录末尾还有 4 字节 info）
  加密包（hook/tpm）的索引段为乱码，文件名无法解码 → 报不支持。
"""
import os
import struct
import zlib

XP3_MAGIC = b'XP3\r\n\x1a\n'
VERSION_NO_CHECKSUM = 0x0C


class Xp3Error(Exception):
    """xp3 处理失败（格式错误 / 已加密 / 不支持）"""


def _decode_name(raw):
    try:
        name = raw.decode('utf-16-le')
    except UnicodeDecodeError as e:
        raise Xp3Error('该 xp3 已加密或格式不支持（文件名无法解码）') from e
    return name.rstrip('\x00')


def parse_index(data):
    """解析 xp3 字节 → (版本, [文件信息])。文件信息: {name, segs:[(off,orig,comp,flag)], info}
    头部布局（无校验版 27 字节）:
      magic 7 + version 4 (offset 7) + index_offset 8 (offset 11) + index_size 8 (offset 19)
      version & 0x10000 时 offset 27 处还有 8 字节校验和"""
    if len(data) < 27 or data[:7] != XP3_MAGIC:
        raise Xp3Error('不是有效的 xp3 文件')
    version = struct.unpack_from('<I', data, 7)[0]
    index_off, index_size = struct.unpack_from('<QQ', data, 11)
    if index_off + index_size > len(data):
        raise Xp3Error('索引越界，该 xp3 已加密或损坏')
    idx = data[index_off:index_off + index_size]
    count = struct.unpack_from('<I', idx, 0)[0]
    pos = 4
    files = []
    for _ in range(count):
        name_len = struct.unpack_from('<H', idx, pos)[0]
        pos += 2
        name = _decode_name(idx[pos:pos + name_len])
        pos += name_len
        seg_count = struct.unpack_from('<I', idx, pos)[0]
        pos += 4
        segs = []
        for _ in range(seg_count):
            off, orig, comp = struct.unpack_from('<QQQ', idx, pos)
            pos += 24
            flag = struct.unpack_from('<I', idx, pos)[0]
            pos += 4
            segs.append((off, orig, comp, flag))
        info = None
        if version & 0x10000 and pos + 4 <= len(idx):
            info = struct.unpack_from('<I', idx, pos)[0]
            pos += 4
        files.append({'name': name, 'segs': segs, 'info': info})
    return version, files


def unpack_bytes(data, out_dir):
    """解包 xp3 字节到 out_dir，返回文件列表 [{name, size}]"""
    version, files = parse_index(data)
    for f in files:
        chunks = []
        for off, orig, comp, flag in f['segs']:
            if off + comp > len(data):
                raise Xp3Error('段数据越界（%s），该 xp3 已加密或损坏' % f['name'])
            raw = data[off:off + comp]
            try:
                chunks.append(zlib.decompress(raw) if (flag & 1) else raw[:orig])
            except zlib.error as e:
                raise Xp3Error('解压失败（%s），该 xp3 已加密或损坏' % f['name']) from e
        content = b''.join(chunks)
        rel = f['name'].replace('\\', os.sep)
        out_path = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'wb') as o:
            o.write(content)
    return [{'name': f['name'], 'size': sum(c for _, _, c, _ in f['segs'])} for f in files]


def unpack_file(path, out_dir):
    with open(path, 'rb') as f:
        return unpack_bytes(f.read(), out_dir)


def pack_bytes(files_dict, version=VERSION_NO_CHECKSUM, compress=True):
    """把 {name: bytes} 封包为 xp3 字节（每文件一段，可选 zlib 压缩）"""
    body = b''
    index_entries = []
    for name in sorted(files_dict):
        content = files_dict[name]
        comp = zlib.compress(content, 6) if compress else content
        flag = 1 if compress else 0
        # 段偏移是相对 xp3 文件头的绝对偏移（header 27 字节在前）
        segs = [(27 + len(body), len(content), len(comp), flag)]
        body += comp
        name_bytes = name.replace('/', '\\').encode('utf-16-le') + b'\x00\x00'  # UTF-16LE null 终止符 2 字节
        index_entries.append((name_bytes, segs))
    idx = struct.pack('<I', len(index_entries))
    for name_bytes, segs in index_entries:
        idx += struct.pack('<H', len(name_bytes)) + name_bytes
        idx += struct.pack('<I', len(segs))
        for off, orig, comp, flag in segs:
            idx += struct.pack('<QQQI', off, orig, comp, flag)
    index_off = 27 + len(body)
    return XP3_MAGIC + struct.pack('<IQQ', version, index_off, len(idx)) + body + idx


def pack_file(files_dict, out_path, **kw):
    with open(out_path, 'wb') as f:
        f.write(pack_bytes(files_dict, **kw))
