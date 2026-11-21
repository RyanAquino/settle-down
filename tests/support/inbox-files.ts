import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exercise the same snapshot, rename and deletion behavior against a fresh disk directory per test.
export const Paths = { document: '' };

class Entry {
  path: string;
  constructor(...parts: (string | Entry)[]) {
    this.path = path.join(
      ...parts.map((part) => {
        if (part instanceof Entry) return part.path;
        return part.startsWith('file:') ? fileURLToPath(part) : part;
      }),
    );
  }
  get name() {
    return path.basename(this.path);
  }
  get uri() {
    return pathToFileURL(this.path).href;
  }
  get exists() {
    return fs.existsSync(this.path);
  }
  rename(name: string) {
    const destination = path.join(path.dirname(this.path), name);
    fs.renameSync(this.path, destination);
    this.path = destination;
  }
  delete() {
    fs.rmSync(this.path, { recursive: true });
  }
}
export class File extends Entry {
  get extension() {
    return path.extname(this.path);
  }
  async copy(destination: File) {
    await fs.promises.copyFile(this.path, destination.path);
  }
  moveSync(destination: File) {
    fs.renameSync(this.path, destination.path);
    this.path = destination.path;
  }
  writeSync(text: string) {
    fs.writeFileSync(this.path, text);
  }
  textSync() {
    return fs.readFileSync(this.path, 'utf8');
  }
}
export class Directory extends Entry {
  create() {
    fs.mkdirSync(this.path, { recursive: true });
  }
  list() {
    return fs
      .readdirSync(this.path, { withFileTypes: true })
      .map((entry) =>
        entry.isDirectory() ? new Directory(this, entry.name) : new File(this, entry.name),
      );
  }
}
export function setupInboxFiles() {
  beforeEach(() => {
    Paths.document = fs.mkdtempSync(path.join(tmpdir(), 'settle-inbox-test-'));
  });
  afterEach(() => {
    fs.rmSync(Paths.document, { recursive: true, force: true });
  });
}
export function samplePhoto() {
  const photo = new File(Paths.document, 'camera-cache.jpg');
  photo.writeSync('receipt photo');
  return photo;
}
