import { afterEach, describe, expect, it, vi } from 'vitest'
import { estimateRoute, type RoutePoint } from '../src/lib/routing'
const a: RoutePoint = { lat:20.15, lon:74.23, label:'Chosen origin',precision:'representative',evidence:'Explicitly selected for hypothetical routing' }
const b: RoutePoint = { lat:19.1, lon:73.0, label:'Chosen destination',precision:'representative',evidence:'Explicitly selected for hypothetical routing' }
afterEach(()=>vi.unstubAllGlobals())
describe('road routing evidence gates',()=>{
 it('rejects centroids without making a request',async()=>{
  const f=vi.fn(); vi.stubGlobal('fetch',f)
  await expect(estimateRoute({...a,precision:'district'},b)).rejects.toThrow(/location/i)
  expect(f).not.toHaveBeenCalled()
 })
 it('requires evidence and finite India-range coordinates',async()=>{
  await expect(estimateRoute({...a,evidence:''},b)).rejects.toThrow(/evidence/i)
  await expect(estimateRoute({...a,lat:NaN},b)).rejects.toThrow(/coordinate/i)
 })
 it('retains real geometry and keeps road metrics separate from freight',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',waypoints:[{distance:10},{distance:20}],routes:[{distance:200000,duration:14400,geometry:{type:'LineString',coordinates:[[74.23,20.15],[73.5,19.8],[73,19.1]]}}]})}))
  const r=await estimateRoute(a,b)
  expect(r.distanceKm).toBe(200);expect(r.durationHours).toBe(4)
  expect(r.geometry.coordinates).toHaveLength(3);expect(r.truckSuitable).toBe(false)
  expect(r.warnings.join(' ')).toMatch(/freight/i)
  expect(r).not.toHaveProperty('freight')
 })
 it('does not invent a route on provider failure',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:503}))
  await expect(estimateRoute(a,b)).rejects.toThrow(/unavailable/i)
 })
 it('rejects absent and malformed geometry and distant road snapping',async()=>{
  for(const geometry of [null,{type:'LineString',coordinates:[[0,0],[1,1]]}]){
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',routes:[{distance:100,duration:100,geometry}]})}))
   await expect(estimateRoute(a,b)).rejects.toThrow(/geometry/i)
  }
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({code:'Ok',waypoints:[{distance:3000},{distance:20}],routes:[{distance:200000,duration:14400,geometry:{type:'LineString',coordinates:[[74.23,20.15],[73,19.1]]}}]})}))
  await expect(estimateRoute(a,b)).rejects.toThrow(/snap/i)
 })
})
