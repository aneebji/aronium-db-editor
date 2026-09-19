function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function view(size: number, write: (data: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const { time, day } = dosDateTime();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = new TextEncoder().encode(file.name.replaceAll("\\", "/"));
    const data = file.data;
    const crc = crc32(data);
    const local = concat([
      view(30, (dv) => {
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(8, 0, true);
        dv.setUint16(10, time, true);
        dv.setUint16(12, day, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, data.length, true);
        dv.setUint32(22, data.length, true);
        dv.setUint16(26, name.length, true);
      }),
      name,
      data,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        view(46, (dv) => {
          dv.setUint32(0, 0x02014b50, true);
          dv.setUint16(4, 20, true);
          dv.setUint16(6, 20, true);
          dv.setUint16(10, 0, true);
          dv.setUint16(12, time, true);
          dv.setUint16(14, day, true);
          dv.setUint32(16, crc, true);
          dv.setUint32(20, data.length, true);
          dv.setUint32(24, data.length, true);
          dv.setUint16(28, name.length, true);
          dv.setUint32(42, offset, true);
        }),
        name,
      ]),
    );
    offset += local.length;
  }

  const central = concat(centrals);
  const end = view(22, (dv) => {
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, files.length, true);
    dv.setUint16(10, files.length, true);
    dv.setUint32(12, central.length, true);
    dv.setUint32(16, offset, true);
  });
  return concat([...locals, central, end]);
}
