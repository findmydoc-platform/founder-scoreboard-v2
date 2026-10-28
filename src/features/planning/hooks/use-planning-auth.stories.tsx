import {useEffect,useState,useSyncExternalStore,useCallback} from "react";
import type {Meta,StoryObj} from "@storybook/nextjs-vite";
import {expect,userEvent,within,waitFor} from "storybook/test";
import type {User} from "@supabase/supabase-js";
import {usePlanningAuth} from "./use-planning-auth";
import {createBrowserPlanningState} from "../model/internal/browser-planning-state";
import {emptyPlanningShellState} from "../model/planning-shell-state";
import {emptyPlanningHeaderData} from "@/lib/planning-header-data";
import {createBrowserApiClient} from "@/lib/browser-api-client";
import {getProtectedPlanningShellStateCache} from "../model/internal/planning-protected-cache";
const session={userId:"admission-user",revision:"admission-session",expiresAt:Math.floor(Date.now()/1000)+3600,user:{id:"admission-user"}};
const profile={id:"actor",name:"Angezeigte Person",platformRole:"viewer" as const,githubLogin:"reader"};
function Fixture({denied=false,late=false}:{denied?:boolean;late?:boolean}){
 const [readCount,setReadCount]=useState(0);
 const [network]=useState(()=>{const original=window.fetch;let reads=0;let finish:undefined|(()=>void);window.fetch=async(input,init)=>{
 const path=String(input);if(path==="/api/auth/session")return Response.json({session});
 if(path==="/api/planning-board-data"){reads++;setReadCount(reads);if(late)await new Promise<void>(resolve=>{finish=resolve;});return denied?Response.json({error:"Kein Zugriff"},{status:403}):Response.json({currentProfile:profile,model:{revision:"read",project:emptyPlanningShellState.project,items:[],people:[{...profile,orgRole:"Viewer",weeklyCapacity:0}],sprints:[],relationships:[],preferences:[],coverage:{items:"complete",people:"complete",sprints:"complete",relationships:"complete",preferences:"complete"}}});}
 return original(input,init);};return{restore:()=>{window.fetch=original;},reads:()=>reads,finish:()=>finish?.()};});
 useEffect(()=>network.restore,[network]);
 const[browser]=useState(()=>{const value=createBrowserPlanningState({initialData:emptyPlanningShellState,initialHeaderData:emptyPlanningHeaderData,initialCurrentProfile:null,initialUserId:session.userId,initialWorkspace:"planning"});value.runtime.session=session;value.runtime.apiClient=createBrowserApiClient({sessionPort:{current:async()=>session,recover:async()=>({kind:"superseded"}),clearIfCurrent:async()=>{}}});return value;});
 useSyncExternalStore(browser.owner.planning.subscribe,browser.owner.internal.getSnapshot,browser.owner.internal.getSnapshot);
 const signedOut=useCallback(()=>{},[]);const loadGithub=useCallback(async()=>true,[]);
 const auth=usePlanningAuth({planningState:browser.owner.planning,authRequired:true,source:"supabase",workspace:"planning",taskCount:0,initialAuthUser:session.user as User,initialProtectedDataLoaded:false,loadGitHubConnection:loadGithub,clearPlanningState:browser.owner.internal.suspendProtected,onSignedOut:signedOut});
 return <main><output aria-label="Admission">{auth.protectedDataLoaded?"accepted":"withheld"}</output><output aria-label="Accepted profile">{auth.serverCurrentProfile?.name || "none"}</output><output aria-label="Cache profile">{getProtectedPlanningShellStateCache("planning",session)?.currentProfile?.name || "none"}</output><output aria-label="Read count">{readCount}</output><p>{auth.authError}</p><button onClick={()=>browser.owner.internal.endSession()}>End owner</button><button onClick={()=>network.finish()}>Finish original read</button></main>;
}
const meta={title:"Planning/Hooks/AcceptedAuthAdmission",component:Fixture} satisfies Meta<typeof Fixture>;export default meta;type Story=StoryObj<typeof meta>;
export const AcceptedReadPublishesProfileAndCacheOnce:Story={play:async({canvasElement})=>{const c=within(canvasElement);await waitFor(()=>expect(c.getByLabelText("Admission")).toHaveTextContent("accepted"));await expect(c.getByLabelText("Accepted profile")).toHaveTextContent(profile.name);await expect(c.getByLabelText("Cache profile")).toHaveTextContent(profile.name);await expect(c.getByLabelText("Read count")).toHaveTextContent("1");}};
export const DeniedReadCannotAdmitOrCache:Story={args:{denied:true},play:async({canvasElement})=>{const c=within(canvasElement);await expect(await c.findByText("Planungsdaten konnten nicht geladen werden.")).toBeVisible();await expect(c.getByLabelText("Admission")).toHaveTextContent("withheld");await expect(c.getByLabelText("Cache profile")).toHaveTextContent("none");}};
export const EndedReadCannotAdmitOrCache:Story={args:{late:true},play:async({canvasElement})=>{const c=within(canvasElement);await waitFor(()=>expect(c.getByLabelText("Read count")).toHaveTextContent("1"));await userEvent.click(c.getByRole("button",{name:"End owner"}));await userEvent.click(c.getByRole("button",{name:"Finish original read"}));await expect(await c.findByText("Planungsdaten konnten nicht geladen werden.")).toBeVisible();await expect(c.getByLabelText("Admission")).toHaveTextContent("withheld");await expect(c.getByLabelText("Cache profile")).toHaveTextContent("none");}};
