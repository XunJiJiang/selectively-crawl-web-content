import { describe, expect, it } from 'vitest';
import { DeclarativeUIService } from './declarative-ui.ts';
import { PageSessions } from './page-sessions.ts';
import type { Request } from 'express';
import type { UIWireRegistry, UIValue } from '../../shared/declarative-ui.ts';
const registry = (program: string): UIWireRegistry => ({
  handlers: [{ name: 'save', readOnly: false, watch: false, reads: [] }],
  views: [
    {
      surface: 'mainSidebar',
      definition: {
        id: 'test',
        title: 'Test',
        content: {
          format: 'html',
          version: 1,
          html: `<input name="query"><button for="query" onclick="${program}">保存</button>`,
        },
      },
    },
  ],
  mounts: [],
  inspector: false,
});
async function setup(program: string, invoke: (data: Record<string, unknown>) => Promise<unknown>) {
  const service = new DeclarativeUIService();
  await service.install('p', 'epoch', process.cwd(), registry(program), invoke);
  const instance = await service.create({
    pluginId: 'p',
    surface: 'mainSidebar',
    viewId: 'test',
    windowId: 'window',
    workspaceId: 'workspace',
    tabId: null,
    sourceTabId: null,
    sourceFrameEpoch: null,
  });
  return { service, instance };
}
describe('handler execution and page authorization', () => {
  it('rejects hiding page information without a valid template, including direct registry updates', async () => {
    const service = new DeclarativeUIService();
    const invalidContents: UIValue[] = [null, {}, { format: 'text', text: 'not a template' }];
    for (const content of invalidContents) {
      await expect(service.install('p', 'epoch', process.cwd(), {
        handlers: [], mounts: [], inspector: false,
        views: [{ surface: 'auxiliarySidebar', definition: { id: 'details', title: 'Details', hideCurrentPage: true, content } }],
      }, async () => null)).rejects.toThrow('必须提供 JSON 或 HTML 模板');
    }
    expect(service.registry('window').items).toHaveLength(0);
  });
  it('commits completed branches and discards effects from a failed branch',async()=>{
    const {service,instance}=await setup("core:value.write('query','first'),core:value.write('query','discard')|save($prev)",async()=>{throw Error('private backend details');});
    const response=await service.execute(instance.id,'window',{eventId:'partial',renderRevision:instance.renderRevision,bindingId:'e0',fields:{query:'initial'}}) as {status:string;effects:{args:unknown[]}[];error:{message:string}};
    expect(response.status).toBe('partial');expect(response.effects.map(effect=>effect.args[1])).toEqual(['first']);expect(response.error.message).not.toContain('private');service.releaseOwner('epoch');
  });
  it('consumes frontend phase acknowledgements once before continuing backend branches',async()=>{
    let calls=0;let finish:()=>void=()=>{ /* Replaced when the backend begins. */ };
    const service=new DeclarativeUIService();await service.install('p','epoch',process.cwd(),registry('ui:select($event),save($event)'),async()=>{calls++;await new Promise<void>(resolve=>finish=resolve);return{hasValue:true,value:'done'};});
    const instance=await service.create({pluginId:'p',surface:'mainSidebar',viewId:'test',windowId:'window',workspaceId:'workspace',tabId:null,sourceTabId:'source',sourceFrameEpoch:'document'});
    const response=await service.execute(instance.id,'window',{eventId:'mixed',renderRevision:instance.renderRevision,bindingId:'e0',fields:{query:'initial'}}) as {status:string;continuation:string};
    expect(response.status).toBe('frontend');const first=service.continueEvent(instance.id,'window',response.continuation,true),duplicate=service.continueEvent(instance.id,'window',response.continuation,true);
    expect(first).toBe(duplicate);await expect.poll(()=>calls).toBe(1);finish();expect(await first).toMatchObject({status:'succeeded',result:'done'});expect(await duplicate).toMatchObject({status:'succeeded'});service.releaseOwner('epoch');
  });
  it('passes filtered augmented events, supports explicit arguments and deduplicates effects', async () => {
    let calls = 0;
    const { service, instance } = await setup('save', async (data) => {
      calls++;
      return { hasValue: true, value: (data.args as UIValue[])[0] };
    });
    const body = {
      eventId: 'one',
      renderRevision: instance.renderRevision,
      bindingId: instance.compiled.events[0].id,
      fields: { query: { value: 'abc', editSequence: 1 } },
      event: { type: 'forged', modifiers: { alt: false, ctrl: true, meta: false, shift: false } },
    };
    const first = (await service.execute(instance.id, 'window', body)) as {
      result: { type: string; value: string; values: unknown };
    };
    expect(first.result).toMatchObject({ type: 'click', value: 'abc', values: { query: 'abc' } });
    await service.execute(instance.id, 'window', body);
    expect(calls).toBe(1);
    expect(() =>
      service.execute(instance.id, 'window', {
        ...body,
        fields: { query: { value: 'different', editSequence: 1 } },
      }),
    ).toThrow('冲突');
    expect(() => service.get(instance.id, 'other')).toThrow();
    service.releaseOwner('epoch');
    expect(() => service.get(instance.id, 'window')).toThrow();
  });
  it('uses positional parameters and previous results entirely in the backend', async () => {
    let args: unknown;
    const { service, instance } = await setup(
      "core:string.trim($for:query)|save($prev,123,'abc')",
      async (data) => {
        args = data.args;
        return { hasValue: true, value: null };
      },
    );
    await service.execute(instance.id, 'window', {
      eventId: 'two',
      renderRevision: instance.renderRevision,
      bindingId: 'e0',
      fields: { query: '  term  ' },
    });
    expect(args).toEqual(['term', 123, 'abc']);
    service.releaseOwner('epoch');
  });
  it('returns the exact unavailable message for a frontend branch without borrowing another tab', async () => {
    const { service, instance } = await setup('ui:save($event)', async () => {
      throw Error('must not call backend');
    });
    const result = await service.execute(instance.id, 'window', {
      eventId: 'front',
      renderRevision: instance.renderRevision,
      bindingId: 'e0',
      fields: { query: 'x' },
    });
    expect(result).toMatchObject({ status: 'unavailable', result: '<无数据，需要打开插件页面>' });
    service.releaseOwner('epoch');
  });
  it('permits only the exact read configuration route for page grants', () => {
    const sessions = new PageSessions();
    const page = sessions.create({
      pluginId: 'p',
      safeId: 'safe',
      tabId: 'tab',
      frameEpoch: 'epoch',
      owner: 'window',
      origin: 'http://localhost',
    });
    const req = (method: string, path: string) =>
      ({ method, path, headers: { authorization: 'Bearer ' + page.grant } }) as Request;
    expect(sessions.authorize(req('GET', '/web/api/workbench/plugins/p/config'), page.origin)).toBe(
      page,
    );
    for (const suffix of ['', '/update', '/reset', '/definitions', '/validation']) {
      expect(() =>
        sessions.authorize(
          req('POST', '/web/api/workbench/plugins/p/config' + suffix),
          page.origin,
        ),
      ).toThrow();
    }
    expect(() =>
      sessions.authorize(req('GET', '/web/api/workbench/plugins/other/config'), page.origin),
    ).toThrow();
  });
});
