'use strict';
// Extract regular files/directories only. Archive metadata is untrusted.
const yauzl = require('yauzl');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

function checkEntryName(name, base, seen) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') ||
      name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw Error('Unsafe ZIP filename.');
  const folder = name.endsWith('/');
  const parts = (folder ? name.slice(0, -1) : name).split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1F]/.test(part) ||
      /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) {
    throw Error('Unsafe Windows ZIP filename.');
  }
  const relative = parts.join(path.sep);
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw Error('ZIP path escapes install directory.');
  const identity = parts.join('/').toLowerCase();
  if (seen.has(identity)) throw Error('Duplicate ZIP entry path.');
  seen.add(identity);
  return { target, folder };
}

function extractGameZip(zipPath, outputDir, { maxEntries = 5000, maxBytes = 4 * 1024 ** 3 } = {}) {
  const base = path.resolve(outputDir);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true }, (openError, archive) => {
      if (openError) return reject(openError);
      let settled = false, count = 0, total = 0;
      const seen = new Set();
      const fail = error => {
        if (settled) return;
        settled = true;
        archive.close();
        reject(error);
      };
      archive.on('error', fail);
      archive.on('end', () => { if (!settled) { settled = true; resolve({ count, total }); } });
      archive.on('entry', async entry => {
        try {
          if (++count > maxEntries) throw Error('Too many ZIP entries.');
          const { target, folder } = checkEntryName(entry.fileName, base, seen);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          // Unix symlinks and all special file types are refused.
          if (mode && mode !== 0o100000 && mode !== 0o040000) throw Error('ZIP contains a link or special file.');
          if (folder !== (mode === 0o040000) && mode !== 0) throw Error('Invalid ZIP directory type.');
          const size = entry.uncompressedSize;
          if (!Number.isSafeInteger(size) || size < 0 || total + size > maxBytes) throw Error('ZIP uncompressed size limit exceeded.');
          if (folder) {
            if (size !== 0) throw Error('Invalid ZIP directory.');
            await fsp.mkdir(target, { recursive: true });
            archive.readEntry();
            return;
          }
          await fsp.mkdir(path.dirname(target), { recursive: true });
          archive.openReadStream(entry, async (streamError, stream) => {
            if (streamError) return fail(streamError);
            let written = 0;
            const meter = new Transform({
              transform(chunk, _encoding, callback) {
                written += chunk.length;
                total += chunk.length;
                if (written > size || total > maxBytes) return callback(Error('Uncompressed size limit exceeded.'));
                callback(null, chunk);
              }
            });
            try {
              await pipeline(stream, meter, fs.createWriteStream(target, { flags: 'wx' }));
              if (written !== size) throw Error('Unexpected ZIP file size.');
              archive.readEntry();
            } catch (err) { fail(err); }
          });
        } catch (err) { fail(err); }
      });
      archive.readEntry();
    });
  });
}
module.exports = { extractGameZip };
