#!/usr/bin/env node
/**
 * Writes src/data/bundled-images.json: the images in public/images/ with their size, so the admin's
 * image picker can offer them next to uploaded images. Runs before every build (see package.json).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'images');
const out = path.join(root, 'src', 'data', 'bundled-images.json');

async function walk(current) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => (entry.isDirectory() ? walk(path.join(current, entry.name)) : [path.join(current, entry.name)])));
  return files.flat();
}

const files = (await walk(dir)).filter((file) => /\.(webp|png|jpe?g|avif)$/i.test(file)).sort();
const images = [];
for (const file of files) {
  const { width, height } = await sharp(file).metadata();
  const stat = await fs.stat(file);
  images.push({ path: `/images/${path.relative(dir, file).split(path.sep).join('/')}`, width, height, size: stat.size });
}
await fs.writeFile(out, `${JSON.stringify(images, null, 2)}\n`);
console.log(`bundled-images.json: ${images.length} Bilder`);
