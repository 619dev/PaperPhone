const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middlewares/auth');
const { ensureBucket, uploadFile } = require('../db/minio');

const router = express.Router();
router.use(authMiddleware);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/', 'audio/', 'video/', 'application/pdf', 'application/'];
    const ok = allowed.some(t => file.mimetype.startsWith(t));
    cb(ok ? null : new Error('File type not allowed'), ok);
  },
});

// POST /api/upload
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    await ensureBucket();

    const ext = path.extname(req.file.originalname) || '';
    const objectName = `${uuidv4()}${ext}`;
    const url = await uploadFile(objectName, req.file.buffer, req.file.mimetype);

    res.json({ url, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
  } catch (err) { next(err); }
});

module.exports = router;
