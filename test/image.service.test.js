const test = require('node:test');
const assert = require('node:assert/strict');
const { detectImageMimeType } = require('../src/services/image.service');

test('image upload accepts content signatures for supported formats', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  const avif = Buffer.from('0000ftypavif0000', 'ascii');

  assert.equal(detectImageMimeType(jpeg), 'image/jpeg');
  assert.equal(detectImageMimeType(png), 'image/png');
  assert.equal(detectImageMimeType(webp), 'image/webp');
  assert.equal(detectImageMimeType(avif), 'image/avif');
});

test('image upload rejects content without a supported file signature', () => {
  assert.equal(detectImageMimeType(Buffer.from('not an image')), null);
  assert.equal(detectImageMimeType('image data'), null);
});
