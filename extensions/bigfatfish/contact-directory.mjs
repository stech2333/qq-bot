const idOf = value => /^[1-9]\d{4,15}$/.test(String(value ?? '')) ? String(value) : '';
const label = value => String(value || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 120);

// Administrator-only account directory, never added to any model prompt or global learning state.
export class ContactDirectory {
  constructor(app) { this.app=app; this.cache=null; this.pending=null; }
  configured(kind) {
    const field=kind==='group'?'groups':'private';
    return [...new Set([...(this.app.config.allow?.[field]||[]),...(this.app.config.deny?.[field]||[]),
      ...[...this.app.states.keys()].filter(key=>key.startsWith(kind+':')).map(key=>key.split(':')[1])].map(idOf).filter(Boolean))];
  }
  async view(hooks, now=Date.now()) {
    const account=String(this.app.config.bigfatfish.expectedQQ), verified=String(hooks.gatewayQQ?.()||'')===account;
    let source={groups:[],friends:[],errors:[]};
    if(verified){
      if(!this.cache||this.cache.account!==account||now-this.cache.at>=60000){
        if(!this.pending)this.pending=(async()=>{
          const replies=await Promise.allSettled(['get_group_list','get_friend_list'].map(action=>hooks.request(action,{}, {timeoutMs:10000})));
          const data={account,at:Date.now(),groups:[],friends:[],errors:[]};
          for(const [i,result]of replies.entries()){
            const field=i===0?'groups':'friends',title=i===0?'群列表':'好友列表';
            if(result.status!=='fulfilled'){data.errors.push(title+'暂时无法读取，请稍后刷新');continue;}
            const payload=result.value;
            if(payload?.retcode!==undefined&&payload.retcode!==0){data.errors.push(title+'读取失败');continue;}
            const rows=Array.isArray(payload)?payload:payload?.data;
            if(!Array.isArray(rows)){data.errors.push(title+'返回格式无效');continue;}
            data[field]=rows.map(row=>({id:idOf(i===0?row.group_id:row.user_id),name:label(i===0?row.group_name:row.remark||row.nickname)})).filter(row=>row.id);
          }
          this.cache=data;return data;
        })().finally(()=>{this.pending=null;});
        source=await this.pending;
      }else source=this.cache;
    }else source.errors=['QQ 身份尚未核验，当前仅显示已配置的会话'];
    const merge=(kind,rows)=>{
      const field=kind==='group'?'groups':'private',map=new Map(rows.map(row=>[row.id,{...row,available:true}]));
      for(const id of this.configured(kind))if(!map.has(id))map.set(id,{id,name:'已配置会话',available:false});
      return [...map.values()].map(row=>({...row,enabled:(this.app.config.allow?.[field]||[]).map(String).includes(row.id)&&!(this.app.config.deny?.[field]||[]).map(String).includes(row.id)}));
    };
    return {ok:true,verified,groups:merge('group',source.groups),friends:merge('private',source.friends),errors:source.errors,updatedAt:source.at||0};
  }
}
