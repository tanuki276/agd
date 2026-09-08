const fs = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  const type = req.query?.type || 'dict';
  const file = req.query?.file;
  if (!file) return res.status(400).send('file パラメータが必要です');

  // Prevent path traversal while preserving nested dictionary paths.
  const baseDir = path.resolve(type === 'dict' ? path.join(process.cwd(), 'dict') : path.join(process.cwd(), 'data'));
  const filePath = path.resolve(baseDir, file);
  if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
    return res.status(400).send('不正なファイルパスです');
  }

  fs.readFile(filePath, type === 'data' ? 'utf8' : null, (err, data) => {
    if (err) return res.status(404).send('Not found');
    res.setHeader('Content-Type', type === 'data' ? 'application/json; charset=utf-8' : 'application/gzip');
    return res.status(200).send(data);
  });
};
