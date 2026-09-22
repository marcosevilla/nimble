import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
let output, rendered
before(async () => {
  const root=fileURLToPath(new URL('../',import.meta.url))
  const cache=path.join(root,'node_modules/.cache')
  await mkdir(cache,{recursive:true})
  output=await mkdtemp(path.join(cache,'google-setup-test-'))
  await build({root,configFile:false,logLevel:'error',plugins:[react()],resolve:{alias:{'@':path.join(root,'src')}},build:{ssr:path.join(root,'tests/fixtures/googleSetupRender.tsx'),outDir:output,emptyOutDir:true,rollupOptions:{output:{entryFileNames:'render.mjs'}}}})
  rendered=await import(pathToFileURL(path.join(output,'render.mjs')).href)
})
after(async()=> {if(output) await rm(output,{recursive:true,force:true})})
test('Google setup Save button submits its form with the real Base UI button',()=> {
  const html=rendered.renderGoogleSetup()
  const button=html.match(/<button\b[^>]*>Save (?:client ID|Google setup)<\/button>/)?.[0]
  assert.ok(button,'setup save button is rendered')
  assert.match(button,/type="submit"/)
})
test('desktop client secret starts empty and masked',()=> {
  const html=rendered.renderGoogleSetup()
  const field=html.match(/<input\b[^>]*id="google-secret"[^>]*>/)?.[0]
  assert.ok(field,'write-only client secret field is rendered')
  assert.match(field,/type="password"/)
  assert.match(field,/autoComplete="off"/i)
  assert.match(field,/value=""/)
})
test('reminder timezone Save button submits its form',()=> {
  assert.match(rendered.renderReminderSetup().match(/<button\b[^>]*>Save timezone<\/button>/)?.[0]??'',/type="submit"/)
})
