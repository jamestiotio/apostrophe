const t = require('../test-lib/test.js');
const assert = require('assert');
let apos;

const config = {
  root: module,
  modules: {
    '@apostrophecms/i18n': {
      options: {
        locales: {
          en: {
            label: 'English'
          },
          'en-CA': {
            label: 'Canadian English',
            prefix: '/ca/en'
          },
          'en-FR': {
            label: 'Canadian French',
            prefix: '/ca/fr'
          }
        }
      }
    },
    'default-page': {}
  }
};

describe('Locales', function() {

  this.timeout(t.timeout);

  after(function() {
    return t.destroy(apos);
  });

  // EXISTENCE

  it('should replicate key docs across locales at startup', async function() {
    apos = await t.create(config);

    const homes = await apos.doc.db.find({ parkedId: 'home' }).toArray();
    // Draft and published
    assert(homes.length === 6);
    const archives = await apos.doc.db.find({ parkedId: 'archive' }).toArray();
    assert(archives.length === 6);
    const globals = await apos.doc.db.find({ type: '@apostrophecms/global' }).toArray();
    assert(globals.length === 6);
  });

  it('should not replicate redundantly on a second startup in same db', async function() {
    const apos2 = await t.create({
      ...config,
      shortName: apos.options.shortName
    });

    const homes = await apos2.doc.db.find({ parkedId: 'home' }).toArray();
    // Draft and published
    assert(homes.length === 6);
    const archives = await apos2.doc.db.find({ parkedId: 'archive' }).toArray();
    assert(archives.length === 6);
    const globals = await apos2.doc.db.find({ type: '@apostrophecms/global' }).toArray();
    assert(globals.length === 6);

    await apos2.destroy();
  });

  let child, jar;

  it('should have just one locale for a newly inserted draft page', async function() {
    const req = apos.task.getReq({
      mode: 'draft'
    });
    child = await apos.page.insert(req,
      '_home',
      'lastChild',
      {
        title: 'Child Page',
        type: 'default-page'
      }
    );
    const versions = await apos.doc.db.find({ aposDocId: child.aposDocId }).toArray();
    assert(versions.length === 1);
  });

  it('should be able to insert test user', async function() {
    const user = apos.user.newInstance();

    user.title = 'admin';
    user.username = 'admin';
    user.password = 'admin';
    user.email = 'ad@min.com';
    user.role = 'admin';

    return apos.user.insert(apos.task.getReq(), user);
  });

  it('REST: should be able to log in as admin', async () => {
    jar = apos.http.jar();

    await apos.http.post('/api/v1/@apostrophecms/login/login', {
      body: {
        username: 'admin',
        password: 'admin',
        session: true
      },
      jar
    });

    // Confirm login, seems necessary for the session cookie in the jar to work
    // on the next call
    const page = await apos.http.get('/', {
      jar
    });

    assert(page.match(/logged in/));

  });

  it('localize API should succeed', async () => {
    return apos.http.post(`/api/v1/@apostrophecms/page/${child._id}/localize`, {
      body: {
        toLocale: 'en-CA'
      },
      jar
    });
  });

  it('after localizing child page should exist in 2 locales', async () => {
    const versions = await apos.doc.db.find({ aposDocId: child.aposDocId }).toArray();
    assert(versions.length === 2);
    assert(!versions.find(version => version.title !== 'Child Page'));
    const reqEn = apos.task.getReq({
      locale: 'en',
      mode: 'draft'
    });
    const en = await apos.doc.find(reqEn, { slug: '/child-page' }).toObject();
    assert(en);
    assert.strictEqual(en._url, '/child-page');
    const reqEnCA = apos.task.getReq({
      locale: 'en-CA',
      mode: 'draft'
    });
    const enCA = await apos.doc.find(reqEnCA, { slug: '/child-page' }).toObject();
    assert(enCA);
    assert.strictEqual(enCA._url, '/ca/en/child-page');
    // Distinguish the content in this locale
    enCA.title = 'Child Page, Toronto Style';
    assert(apos.page.update(reqEnCA, enCA));
    // Not published yet
    try {
      await apos.http.get('/ca/en/child-page', {});
      assert(false);
    } catch (e) {
      assert(e.status === 404);
    }
    await apos.page.publish(reqEnCA, enCA);
    // Now it should work
    const childPage = await apos.http.get('/ca/en/child-page', {});
    assert(childPage.includes('<title>Child Page, Toronto Style</title>'));
    assert(childPage.includes('"/ca/en/">Home: /'));
    assert(childPage.includes('"/ca/en/child-page">Tab: /child-page'));
    // And the home page should be reachable
    const home = await apos.http.get('/ca/en/');
    assert(home);
  });

});
