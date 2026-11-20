import { execFile } from 'node:child_process';
import { copyFile, glob, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resultSchema } from './policy.mjs';

const exec = promisify(execFile);
const maxBytes = 10_000_000;

// Actions extracts files with new mtimes. Use the recording's UTC creation time
// and Maestro's command timestamps to keep each clip with its own replay.
export async function preparePreviews(evidence, output) {
  const root = await realpath(evidence);
  const regular = async (file) => (await realpath(file)) === file && (await stat(file)).isFile();
  const resultPath = path.join(root, 'result.json');
  if (!(await regular(resultPath))) return;
  const result = resultSchema.parse(JSON.parse(await readFile(resultPath, 'utf8')));
  await mkdir(output, { recursive: true });

  const movie = path.join(root, 'session.mp4');
  let start;
  try {
    if (await regular(movie)) {
      const { stdout } = await exec(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file',
          '-f',
          'mov',
          '-show_entries',
          'format_tags=creation_time',
          '-of',
          'json',
          movie,
        ],
        { timeout: 15000 },
      );
      start = Date.parse(JSON.parse(stdout).format.tags.creation_time);
    }
  } catch {
    console.warn('Recording metadata unavailable. Screenshots can still be published.');
  }

  for (const { id } of result.scenarios) {
    const scenario = path.join(root, 'replay', id);
    const screenshots = new Set();
    let lastCapture = 0;
    for await (const relative of glob('*/*/commands.json', { cwd: scenario })) {
      const commands = path.join(scenario, relative);
      if (!(await regular(commands)) || (await stat(commands)).size > 8_000_000) continue;
      let journal;
      try {
        journal = JSON.parse(await readFile(commands, 'utf8'));
      } catch {
        console.warn('Incomplete command journal for ' + id);
        continue;
      }
      if (!Array.isArray(journal)) continue;
      for (const { metadata } of journal) {
        const failed = metadata?.status === 'FAILED';
        if ((!failed && metadata?.status !== 'COMPLETED') || !Array.isArray(metadata.artifacts))
          continue;
        for (const artifact of metadata.artifacts) {
          const match = failed
            ? /^screenshots\/(step-[\w-]{1,140})\.png$/.exec(artifact?.path)
            : /^takeScreenshot\/([\w-]{1,80})\.png$/.exec(artifact?.path);
          if (!match) continue;
          const stem = failed ? 'failed-step' : match[1];
          const png = path.join(path.dirname(commands), artifact.path);
          if (!(await regular(png).catch(() => false))) continue;
          if (Number.isSafeInteger(metadata.timestamp)) {
            const duration = Number.isSafeInteger(metadata.duration) ? metadata.duration : 0;
            lastCapture = Math.max(lastCapture, metadata.timestamp + duration);
          }
          if (
            (!failed && screenshots.size >= 4) ||
            screenshots.has(stem) ||
            (await stat(png)).size >= maxBytes
          )
            continue;
          await copyFile(png, path.join(output, id + '.' + stem + '.png'));
          screenshots.add(stem);
        }
      }
    }
    if (!Number.isFinite(start) || lastCapture < start) continue;
    const target = path.join(output, id + '.replay.mp4');
    const partial = target + '.partial';
    try {
      await exec(
        'ffmpeg',
        [
          '-nostdin',
          '-y',
          '-v',
          'error',
          '-ss',
          String(Math.max(0, (lastCapture - start) / 1000 - 12)),
          '-protocol_whitelist',
          'file',
          '-f',
          'mov',
          '-i',
          movie,
          '-t',
          '15',
          '-map',
          '0:v:0',
          '-an',
          '-vf',
          'fps=12,scale=480:-2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-crf',
          '24',
          '-maxrate',
          '1500k',
          '-bufsize',
          '3000k',
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          partial,
        ],
        { timeout: 45000 },
      );
      // ffmpeg may exit successfully with zero frames when seeking past EOF.
      const { stdout } = await exec(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=duration',
          '-of',
          'csv=p=0',
          partial,
        ],
        { timeout: 5000 },
      );
      if (Number(stdout.trim()) > 0 && (await stat(partial)).size < maxBytes)
        await rename(partial, target);
    } catch {
      console.warn('Could not prepare the replay clip for ' + id);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePreviews(process.argv[2], process.argv[3]);
}
