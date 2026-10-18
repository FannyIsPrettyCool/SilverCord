import { describe, expect, it } from 'vitest';
import { sniff } from './sniff.ts';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part,
    ),
  );

describe('content sniffing', () => {
  it('recognizes inline image and video formats by signature', () => {
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: 'image', format: 'jpeg' });
    expect(sniff(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({
      kind: 'image',
      format: 'png',
    });
    expect(sniff(bytes('GIF89a'))).toEqual({ kind: 'image', format: 'gif' });
    expect(sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toEqual({
      kind: 'image',
      format: 'webp',
    });
    expect(sniff(bytes([0, 0, 0, 0x20], 'ftypisom'))).toEqual({ kind: 'video', format: 'mp4' });
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3], 'xxxxwebm'))).toEqual({
      kind: 'video',
      format: 'webm',
    });
  });

  it('refuses markup, executables and archives', () => {
    for (const sample of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg">'),
      bytes([0xef, 0xbb, 0xbf], '  \n<html>'),
      bytes('<?xml version="1.0"?>'),
      bytes([0xff, 0xfe, 0x3c, 0x00]),
      bytes('MZ', [0x90, 0]),
      bytes([0x7f], 'ELF'),
      bytes('PK', [3, 4]),
      bytes([0x1f, 0x8b, 8]),
      bytes('#!/bin/sh'),
    ])
      expect(sniff(sample)).toEqual({ kind: 'rejected' });
  });

  it('treats everything else, including unknown containers, as download-only', () => {
    expect(sniff(bytes('%PDF-1.7'))).toEqual({ kind: 'file' });
    expect(sniff(bytes('plain text notes'))).toEqual({ kind: 'file' });
    expect(sniff(bytes([0, 0, 0, 0x14], 'ftypqt  '))).toEqual({ kind: 'file' });
    expect(sniff(new Uint8Array())).toEqual({ kind: 'file' });
  });

  it('does not trust a spoofed image extension on markup', () => {
    // A polyglot that starts as SVG is rejected no matter what the filename claims.
    expect(sniff(bytes('<svg onload="x()">', [0xff, 0xd8, 0xff]))).toEqual({ kind: 'rejected' });
  });
});
