/** Display names are preserved where safe; only filesystem-illegal characters
 * are stripped. Renaming a Recent Model changes the next downloaded filename. */
export function safeModelFilename(name: string, extension: string): string {
  const cleanedName = String(name || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 72).trim();
  const safeExtension = String(extension || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bil';
  const safeBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleanedName)
    ? `_${cleanedName}` : (cleanedName || 'Build It Live');
  return `${safeBase}.${safeExtension}`;
}

/** Export labels are derived from the *current* view, never from a previous
 * downloaded file's name (which may contain an obsolete mode suffix). */
export function surfaceModeFilename(projectName: string, mode: 'voxel' | 'soft1' | string, extension: string): string {
  const base = String(projectName || 'Build It Live')
    .replace(/(?:\s*[-–—]\s*(?:Smooth|Blocks))+\s*$/gi, '').trim() || 'Build It Live';
  return safeModelFilename(`${base} - ${mode === 'soft1' ? 'Smooth' : 'Blocks'}`, extension);
}
