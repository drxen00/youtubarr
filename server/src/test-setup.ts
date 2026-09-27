// Loaded via `node --test --import`: each test process gets a throwaway data dir so tests never
// touch a real database and parallel test files don't race each other's migrations.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'youtubarr-test-'))
process.env.MEDIA_DIR = path.join(process.env.DATA_DIR, 'media')
