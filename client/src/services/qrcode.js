/**
 * QR Code Generator — Lightweight inline implementation
 * Generates QR codes as SVG strings for personal profiles and group invites.
 *
 * Data format:
 *   Personal: pp://user/{user_id}
 *   Group:    pp://group/{invite_id}
 */

// ── Minimal QR Code Encoder (Type 4 QR, ~80-char payload) ─────────────────
// Adapted from kazuhikoarase/qrcode-generator (MIT)

const QRMode = { MODE_NUMBER: 1, MODE_ALPHA_NUM: 2, MODE_8BIT_BYTE: 4 };
const QRErrorCorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };

function QR8bitByte(data) {
  this.data = data;
  this.parsedData = [];
  for (let i = 0; i < this.data.length; i++) {
    const byteArray = [];
    const code = this.data.charCodeAt(i);
    if (code > 0x10000) {
      byteArray[0] = 0xF0 | ((code & 0x1C0000) >>> 18);
      byteArray[1] = 0x80 | ((code & 0x3F000) >>> 12);
      byteArray[2] = 0x80 | ((code & 0xFC0) >>> 6);
      byteArray[3] = 0x80 | (code & 0x3F);
    } else if (code > 0x800) {
      byteArray[0] = 0xE0 | ((code & 0xF000) >>> 12);
      byteArray[1] = 0x80 | ((code & 0xFC0) >>> 6);
      byteArray[2] = 0x80 | (code & 0x3F);
    } else if (code > 0x80) {
      byteArray[0] = 0xC0 | ((code & 0x7C0) >>> 6);
      byteArray[1] = 0x80 | (code & 0x3F);
    } else {
      byteArray[0] = code;
    }
    this.parsedData = this.parsedData.concat(byteArray);
  }
  this.getLength = () => this.parsedData.length;
  this.write = (buffer) => {
    for (let i = 0; i < this.parsedData.length; i++) {
      buffer.put(this.parsedData[i], 8);
    }
  };
}

function QRBitBuffer() {
  this.buffer = [];
  this.length = 0;
  this.get = (index) => ((this.buffer[Math.floor(index / 8)] >>> (7 - index % 8)) & 1) === 1;
  this.put = (num, length) => { for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1); };
  this.getLengthInBits = () => this.length;
  this.putBit = (bit) => {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
    this.length++;
  };
}

function QRPolynomial(num, shift) {
  let offset = 0;
  while (offset < num.length && num[offset] === 0) offset++;
  this.num = new Array(num.length - offset + shift);
  for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  this.get = (index) => this.num[index];
  this.getLength = () => this.num.length;
  this.multiply = (e) => {
    const num2 = new Array(this.getLength() + e.getLength() - 1);
    for (let i = 0; i < num2.length; i++) num2[i] = 0;
    for (let i = 0; i < this.getLength(); i++)
      for (let j = 0; j < e.getLength(); j++)
        num2[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
    return new QRPolynomial(num2, 0);
  };
  this.mod = (e) => {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num2 = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num2[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) num2[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    return new QRPolynomial(num2, 0).mod(e);
  };
}

const QRMath = {
  EXP_TABLE: new Array(256), LOG_TABLE: new Array(256),
  glog: (n) => { if (n < 1) throw new Error('glog(' + n + ')'); return QRMath.LOG_TABLE[n]; },
  gexp: (n) => { while (n < 0) n += 255; while (n >= 256) n -= 255; return QRMath.EXP_TABLE[n]; },
};
(() => {
  for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i++) QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
  for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
})();

const QRUtil = {
  PATTERN_POSITION_TABLE: [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
    [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170],
  ],
  G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
  G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
  G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
  getBCHTypeInfo: (data) => {
    let d = data << 10;
    while (QRUtil._getBCHDigit(d) - QRUtil._getBCHDigit(QRUtil.G15) >= 0)
      d ^= (QRUtil.G15 << (QRUtil._getBCHDigit(d) - QRUtil._getBCHDigit(QRUtil.G15)));
    return ((data << 10) | d) ^ QRUtil.G15_MASK;
  },
  getBCHTypeNumber: (data) => {
    let d = data << 12;
    while (QRUtil._getBCHDigit(d) - QRUtil._getBCHDigit(QRUtil.G18) >= 0)
      d ^= (QRUtil.G18 << (QRUtil._getBCHDigit(d) - QRUtil._getBCHDigit(QRUtil.G18)));
    return (data << 12) | d;
  },
  _getBCHDigit: (data) => { let d = 0; while (data !== 0) { d++; data >>>= 1; } return d; },
  getPatternPosition: (typeNumber) => QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1],
  getMask: (maskPattern, i, j) => {
    switch (maskPattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return (i * j) % 2 + (i * j) % 3 === 0;
      case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
      case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
      default: throw new Error('bad maskPattern:' + maskPattern);
    }
  },
  getErrorCorrectPolynomial: (errorCorrectLength) => {
    let a = new QRPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i++) a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
    return a;
  },
  getLengthInBits: (mode, type) => {
    if (1 <= type && type < 10) {
      switch (mode) { case 1: return 10; case 2: return 9; case 4: return 8; default: throw new Error('mode:' + mode); }
    } else if (type < 27) {
      switch (mode) { case 1: return 12; case 2: return 11; case 4: return 16; default: throw new Error('mode:' + mode); }
    } else if (type < 41) {
      switch (mode) { case 1: return 14; case 2: return 13; case 4: return 16; default: throw new Error('mode:' + mode); }
    } else throw new Error('type:' + type);
  },
  getLostPoint: (qr) => {
    const mc = qr.getModuleCount();
    let lostPoint = 0;
    for (let r = 0; r < mc; r++) {
      for (let c = 0; c < mc; c++) {
        let sameCount = 0;
        const dark = qr.isDark(r, c);
        for (let dr = -1; dr <= 1; dr++) {
          if (r + dr < 0 || mc <= r + dr) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (c + dc < 0 || mc <= c + dc) continue;
            if (dr === 0 && dc === 0) continue;
            if (dark === qr.isDark(r + dr, c + dc)) sameCount++;
          }
        }
        if (sameCount > 5) lostPoint += (3 + sameCount - 5);
      }
    }
    for (let r = 0; r < mc - 1; r++) {
      for (let c = 0; c < mc - 1; c++) {
        let count = 0;
        if (qr.isDark(r, c)) count++;
        if (qr.isDark(r + 1, c)) count++;
        if (qr.isDark(r, c + 1)) count++;
        if (qr.isDark(r + 1, c + 1)) count++;
        if (count === 0 || count === 4) lostPoint += 3;
      }
    }
    for (let r = 0; r < mc; r++) {
      for (let c = 0; c < mc - 6; c++) {
        if (qr.isDark(r, c) && !qr.isDark(r, c + 1) && qr.isDark(r, c + 2) && qr.isDark(r, c + 3) && qr.isDark(r, c + 4) && !qr.isDark(r, c + 5) && qr.isDark(r, c + 6)) lostPoint += 40;
      }
    }
    for (let c = 0; c < mc; c++) {
      for (let r = 0; r < mc - 6; r++) {
        if (qr.isDark(r, c) && !qr.isDark(r + 1, c) && qr.isDark(r + 2, c) && qr.isDark(r + 3, c) && qr.isDark(r + 4, c) && !qr.isDark(r + 5, c) && qr.isDark(r + 6, c)) lostPoint += 40;
      }
    }
    let darkCount = 0;
    for (let c = 0; c < mc; c++) for (let r = 0; r < mc; r++) if (qr.isDark(r, c)) darkCount++;
    const ratio = Math.abs(100 * darkCount / mc / mc - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  },
};

const RS_BLOCK_TABLE = [
  [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
  [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
  [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
  [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
  [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
  [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
  [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
  [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
  [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
  [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
];

function _getRsBlockTable(typeNumber, errorCorrectLevel) {
  switch (errorCorrectLevel) {
    case QRErrorCorrectLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
    case QRErrorCorrectLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
    case QRErrorCorrectLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
    case QRErrorCorrectLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
    default: return undefined;
  }
}

function QRRSBlock(totalCount, dataCount) {
  this.totalCount = totalCount;
  this.dataCount = dataCount;
}
QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
  const rsBlock = _getRsBlockTable(typeNumber, errorCorrectLevel);
  if (!rsBlock) throw new Error('bad rs block @ typeNumber:' + typeNumber + '/ecl:' + errorCorrectLevel);
  const list = [];
  for (let i = 0; i < rsBlock.length; i += 3) {
    const count = rsBlock[i], totalCount = rsBlock[i + 1], dataCount = rsBlock[i + 2];
    for (let j = 0; j < count; j++) list.push(new QRRSBlock(totalCount, dataCount));
  }
  return list;
};

function QRCodeModel(typeNumber, errorCorrectLevel) {
  this.typeNumber = typeNumber;
  this.errorCorrectLevel = errorCorrectLevel;
  this.modules = null;
  this.moduleCount = 0;
  this.dataCache = null;
  this.dataList = [];
}

QRCodeModel.prototype = {
  addData: function(data) { this.dataList.push(new QR8bitByte(data)); this.dataCache = null; },
  isDark: function(row, col) {
    if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) throw new Error(row + ',' + col);
    return this.modules[row][col];
  },
  getModuleCount: function() { return this.moduleCount; },
  make: function() { this.makeImpl(false, this.getBestMaskPattern()); },
  makeImpl: function(test, maskPattern) {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);
    for (let r = 0; r < this.moduleCount; r++) {
      this.modules[r] = new Array(this.moduleCount);
      for (let c = 0; c < this.moduleCount; c++) this.modules[r][c] = null;
    }
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);
    if (this.typeNumber >= 7) this.setupTypeNumber(test);
    if (this.dataCache === null) this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    this.mapData(this.dataCache, maskPattern);
  },
  setupPositionProbePattern: function(row, col) {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if ((0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
          this.modules[row + r][col + c] = true;
        } else {
          this.modules[row + r][col + c] = false;
        }
      }
    }
  },
  getBestMaskPattern: function() {
    let minLostPoint = 0, pattern = 0;
    for (let i = 0; i < 8; i++) {
      this.makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(this);
      if (i === 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
    }
    return pattern;
  },
  setupTimingPattern: function() {
    for (let r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = (r % 2 === 0);
    }
    for (let c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = (c % 2 === 0);
    }
  },
  setupPositionAdjustPattern: function() {
    const pos = QRUtil.getPatternPosition(this.typeNumber);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const row = pos[i], col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
              this.modules[row + r][col + c] = true;
            } else {
              this.modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  },
  setupTypeNumber: function(test) {
    const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++) {
      const mod = (!test && ((bits >> i) & 1) === 1);
      this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i++) {
      const mod = (!test && ((bits >> i) & 1) === 1);
      this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  },
  setupTypeInfo: function(test, maskPattern) {
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      const mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 6) { this.modules[i][8] = mod; }
      else if (i < 8) { this.modules[i + 1][8] = mod; }
      else { this.modules[this.moduleCount - 15 + i][8] = mod; }
    }
    for (let i = 0; i < 15; i++) {
      const mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 8) { this.modules[8][this.moduleCount - i - 1] = mod; }
      else if (i < 9) { this.modules[8][15 - i - 1 + 1] = mod; }
      else { this.modules[8][15 - i - 1] = mod; }
    }
    this.modules[this.moduleCount - 8][8] = (!test);
  },
  mapData: function(data, maskPattern) {
    let inc = -1, row = this.moduleCount - 1, bitIndex = 7, byteIndex = 0;
    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
            const mask = QRUtil.getMask(maskPattern, row, col - c);
            if (mask) dark = !dark;
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) { row -= inc; inc = -inc; break; }
      }
    }
  },
};

QRCodeModel.createData = function(typeNumber, errorCorrectLevel, dataList) {
  const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
  const buffer = new QRBitBuffer();
  for (let i = 0; i < dataList.length; i++) {
    const data = dataList[i];
    buffer.put(QRMode.MODE_8BIT_BYTE, 4);
    buffer.put(data.getLength(), QRUtil.getLengthInBits(QRMode.MODE_8BIT_BYTE, typeNumber));
    data.write(buffer);
  }
  let totalDataCount = 0;
  for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
  if (buffer.getLengthInBits() > totalDataCount * 8) {
    throw new Error('code length overflow. (' + buffer.getLengthInBits() + '>' + totalDataCount * 8 + ')');
  }
  if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
  while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
  while (true) {
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(0xEC, 8);
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(0x11, 8);
  }
  return QRCodeModel.createBytes(buffer, rsBlocks);
};

QRCodeModel.createBytes = function(buffer, rsBlocks) {
  let offset = 0, maxDcCount = 0, maxEcCount = 0;
  const dcdata = new Array(rsBlocks.length), ecdata = new Array(rsBlocks.length);
  for (let r = 0; r < rsBlocks.length; r++) {
    const dcCount = rsBlocks[r].dataCount, ecCount = rsBlocks[r].totalCount - dcCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    dcdata[r] = new Array(dcCount);
    for (let i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
    offset += dcCount;
    const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
    const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    ecdata[r] = new Array(rsPoly.getLength() - 1);
    for (let i = 0; i < ecdata[r].length; i++) {
      const modIndex = i + modPoly.getLength() - ecdata[r].length;
      ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
    }
  }
  let totalCodeCount = 0;
  for (let i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
  const data = new Array(totalCodeCount);
  let index = 0;
  for (let i = 0; i < maxDcCount; i++)
    for (let r = 0; r < rsBlocks.length; r++)
      if (i < dcdata[r].length) data[index++] = dcdata[r][i];
  for (let i = 0; i < maxEcCount; i++)
    for (let r = 0; r < rsBlocks.length; r++)
      if (i < ecdata[r].length) data[index++] = ecdata[r][i];
  return data;
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Generate a QR code and return it as an SVG string
 * @param {string} data - The data to encode
 * @param {object} [opts] - Options
 * @param {number} [opts.size=200] - SVG width/height
 * @param {string} [opts.fg='#000000'] - Foreground (module) color
 * @param {string} [opts.bg='#FFFFFF'] - Background color
 * @param {number} [opts.margin=2] - Quiet zone (in modules)
 * @returns {string} SVG markup
 */
export function generateQRSvg(data, opts = {}) {
  const { size = 200, fg = '#000000', bg = '#FFFFFF', margin = 2 } = opts;

  // Auto-detect typeNumber
  let typeNumber = 0;
  for (let t = 1; t <= 10; t++) {
    const qr = new QRCodeModel(t, QRErrorCorrectLevel.M);
    try {
      qr.addData(data);
      qr.make();
      typeNumber = t;
      break;
    } catch {
      continue;
    }
  }
  if (!typeNumber) typeNumber = 10;

  const qr = new QRCodeModel(typeNumber, QRErrorCorrectLevel.M);
  qr.addData(data);
  qr.make();

  const mc = qr.getModuleCount();
  const totalModules = mc + margin * 2;
  const cellSize = size / totalModules;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  svg += `<rect width="${size}" height="${size}" fill="${bg}"/>`;

  for (let r = 0; r < mc; r++) {
    for (let c = 0; c < mc; c++) {
      if (qr.isDark(r, c)) {
        const x = (c + margin) * cellSize;
        const y = (r + margin) * cellSize;
        svg += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellSize + 0.5).toFixed(2)}" height="${(cellSize + 0.5).toFixed(2)}" fill="${fg}"/>`;
      }
    }
  }

  svg += '</svg>';
  return svg;
}

/**
 * Generate personal profile QR data string
 */
export function userQRData(userId) {
  return `pp://user/${userId}`;
}

/**
 * Generate group invite QR data string
 */
export function groupQRData(inviteId) {
  return `pp://group/${inviteId}`;
}

/**
 * Parse a QR code data string
 * @returns {{ type: 'user'|'group', id: string } | null}
 */
export function parseQRData(data) {
  if (!data) return null;
  const userMatch = data.match(/^pp:\/\/user\/(.+)$/);
  if (userMatch) return { type: 'user', id: userMatch[1] };
  const groupMatch = data.match(/^pp:\/\/group\/(.+)$/);
  if (groupMatch) return { type: 'group', id: groupMatch[1] };
  return null;
}
