const { Readable } = require('stream');
const { downloadDriveFile } = require('../src/controllers/integrations.controller');

describe('Google Drive file downloads', () => {
  test('enforces the size limit while streaming file content', async () => {
    const drive = {
      files: {
        get: jest.fn().mockResolvedValue({
          data: Readable.from([Buffer.from('123'), Buffer.from('456')]),
        }),
      },
    };

    await expect(downloadDriveFile(drive, 'drive-file', 5)).rejects.toMatchObject({
      code: 'DRIVE_FILE_TOO_LARGE',
    });
    expect(drive.files.get).toHaveBeenCalledWith(
      { fileId: 'drive-file', alt: 'media' },
      { responseType: 'stream' }
    );
  });

  test('returns a bounded download as a buffer', async () => {
    const drive = {
      files: {
        get: jest.fn().mockResolvedValue({
          data: Readable.from([Buffer.from('safe'), Buffer.from(' file')]),
        }),
      },
    };

    await expect(downloadDriveFile(drive, 'drive-file', 20)).resolves.toEqual(
      Buffer.from('safe file')
    );
  });
});
