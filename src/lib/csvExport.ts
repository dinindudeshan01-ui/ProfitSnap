// Small, dependency-free CSV export helper. No library needed for
// something this simple, and it keeps every screen's export button
// consistent (same escaping rules, same download mechanism).

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) => {
    const str = String(value);
    // Quote any field containing a comma, quote, or newline, doubling
    // internal quotes — the standard CSV escaping rule (RFC 4180).
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
  // Leading BOM so Excel (including on Windows, common for SL SME back
  // offices) opens UTF-8 files with correct characters instead of
  // mangling anything outside plain ASCII.
  const csv = '\uFEFF' + lines.join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
