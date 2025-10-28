import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';

const rootDir = path.resolve(__dirname, '../../');

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

async function startStaticServer(): Promise<{ close: () => Promise<void>; port: number }> {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    const relativePath = urlPath === '/' ? '/web/admin/mhlw-sync.html' : urlPath;
    const normalizedPath = path.normalize(relativePath.replace(/^\/+/, ''));
    const filePath = path.join(rootDir, normalizedPath);
    if (!filePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    try {
      let targetPath = filePath;
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        targetPath = path.join(targetPath, 'index.html');
      }
      const data = await fs.readFile(targetPath);
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypeFor(targetPath));
      res.end(data);
    } catch (err) {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Failed to start static server');
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test.describe('厚労省ID同期', () => {
  let serverHandle: { close: () => Promise<void>; port: number };

  test.beforeAll(async () => {
    serverHandle = await startStaticServer();
  });

  test.afterAll(async () => {
    await serverHandle.close();
  });

  test('略称検索から厚労省IDを紐づける', async ({ page }) => {
    const clinic = {
      id: 'clinic-1',
      name: 'いしい内科クリニック',
      shortName: 'いしい内科クリニック',
      address: '東京都中野区沼袋3-28-9',
      prefecture: '東京都',
      city: '中野区',
      postalCode: '1650025',
      mhlwFacilityId: null,
    };

    const facilities = [
      {
        facilityId: '1322136100011',
        facilityType: 'clinic',
        name: '医療法人社団あんず会いしい内科クリニック',
        shortName: 'いしい内科クリニック',
        shortNameKana: 'イシイナイカクリニック',
        prefecture: '東京都',
        prefectureName: '東京都',
        city: '中野区',
        cityName: '中野区',
        address: '東京都中野区沼袋３－２８－９',
        postalCode: '1650025',
      },
      {
        facilityId: '2722270077320',
        facilityType: 'clinic',
        name: 'いしい内科クリニック',
        shortName: 'いしい内科クリニック',
        prefecture: '大阪府',
        prefectureName: '大阪府',
        city: '和泉市',
        cityName: '和泉市',
        address: '大阪府和泉市室堂町８２４番地の３　コムボックス光明池１階',
        postalCode: '5941101',
      },
    ];

    await page.route('**/api/mhlw/facilities', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ facilities }),
      });
    });

    const facilitiesResponse = JSON.stringify({ facilities });

    await page.route('**/api/mhlw/facilities', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: facilitiesResponse,
      });
    });

    await page.route('**/tmp/mhlw-facilities.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: facilitiesResponse,
      });
    });

    await page.route('**/api/mhlw/facilities/meta', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          updatedAt: new Date().toISOString(),
          size: 1024,
          etag: 'test',
          cacheControl: 'public, max-age=600',
        }),
      });
    });

    await page.route('**/api/listClinics**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ clinics: [clinic] }),
      });
    });

    let updatePayload: Record<string, unknown> | undefined;
    await page.route('**/api/updateClinic', async (route) => {
      updatePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const authFixture = {
      account: {
        id: 'account-1',
        role: 'systemRoot',
        email: 'system@example.com',
      },
      tokens: {
        accessToken: 'dummy-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        refreshToken: 'dummy-refresh-token',
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };

    await page.addInitScript((storedAuth) => {
      window.localStorage.setItem('ncdAuth', JSON.stringify(storedAuth));
    }, authFixture);

    await page.goto(`http://127.0.0.1:${serverHandle.port}/web/admin/mhlw-sync.html`);
    await expect(page.locator('#clinicListStatus')).toContainText('厚労省ID未設定の診療所');

    const clinicHeading = page.getByRole('heading', { name: 'いしい内科クリニック' }).first();
    await expect(clinicHeading).toBeVisible();
    const clinicCard = clinicHeading.locator('xpath=ancestor::div[contains(@class,"rounded")][contains(@class,"border-slate-200")]').first();
    await expect(clinicCard).toBeVisible();

    const tokyoCandidate = clinicCard.locator('[data-candidate]', { hasText: '東京都中野区沼袋' });
    await expect(tokyoCandidate).toBeVisible();

    await tokyoCandidate.getByRole('button', { name: 'このIDをセット' }).click();
    await expect(clinicCard.getByPlaceholder('例: 1311400001')).toHaveValue('1322136100011');

    await clinicCard.getByRole('button', { name: 'IDを登録' }).click();
    await expect(clinicCard.locator('[data-status]')).toHaveText(/厚労省IDを登録しました。/);

    await expect.poll(() => updatePayload).not.toBeUndefined();
    expect(updatePayload).toEqual({
      name: 'いしい内科クリニック',
      mhlwFacilityId: '1322136100011',
    });
  });
});
