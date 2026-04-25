import { useState } from "react";
import { cn } from "../../lib/utils";
import { useEnvironmentsStore } from "../../store/environments-store";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { EnvironmentEditor } from "./EnvironmentEditor";
import { type EnvironmentRecord } from "../../types/environment";

export function SidebarEnvironments({ searchQuery }: { searchQuery: string }) {
  const environments = useEnvironmentsStore((state) => state.environments);
  const createEnvironment = useEnvironmentsStore((state) => state.createEnvironment);
  const updateEnvironment = useEnvironmentsStore((state) => state.updateEnvironment);
  const deleteEnvironment = useEnvironmentsStore((state) => state.deleteEnvironment);
  
  const hosts = useHostsStore((state) => state.hosts);
  const updateHost = useHostsStore((state) => state.updateHost);
  
  const sessionTabs = useSessionsStore((state) => state.tabs);
  
  const [expandedEnvs, setExpandedEnvs] = useState<Record<string, boolean>>({});
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<EnvironmentRecord | undefined>();
  const [draggedOverEnvId, setDraggedOverEnvId] = useState<string | null>(null);

  const toggleEnv = (envId: string) => {
    setExpandedEnvs(prev => ({ ...prev, [envId]: !prev[envId] }));
  };

  const handleEdit = (e: React.MouseEvent, env: EnvironmentRecord) => {
    e.stopPropagation();
    setEditingEnv(env);
    setIsEditorOpen(true);
  };

  const handleDelete = (e: React.MouseEvent, envId: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this environment?")) {
      deleteEnvironment(envId);
    }
  };

  const onDragStart = (e: React.DragEvent, hostId: string) => {
    e.dataTransfer.setData("text/plain", hostId);
  };

  const onDragOver = (e: React.DragEvent, envId: string) => {
    e.preventDefault();
    setDraggedOverEnvId(envId);
  };

  const onDragLeave = () => {
    setDraggedOverEnvId(null);
  };

  const onDrop = (e: React.DragEvent, envName: string) => {
    e.preventDefault();
    setDraggedOverEnvId(null);
    const hostId = e.dataTransfer.getData("text/plain");
    if (hostId) {
      const host = hosts.find((h) => h.id === hostId);
      if (host && host.group !== envName) {
        updateHost(host.id, {
          label: host.label,
          protocol: host.protocol,
          hostname: host.hostname,
          username: host.username,
          port: String(host.port),
          authMethod: host.authMethod,
          password: "",
          privateKeyPath: host.privateKeyPath,
          passphrase: "",
          group: envName,
          tags: host.tags.join(", "),
          note: host.note,
          favorite: host.favorite,
          keyLabel: host.keyLabel,
          hostKeyPolicy: host.hostKeyPolicy,
          agentForwarding: host.agentForwarding,
          environment: Object.entries(host.environment).map(([k, v]) => `${k}=${v}`).join("\\n"),
          jumpHostId: host.jumpHostId ?? "",
          sftpRoot: host.sftpRoot,
        });
      }
    }
  };

  const activeHostIds = new Set(sessionTabs.map(t => t.hostId).filter(Boolean));

  const filteredEnvs = environments.filter(env => 
    env.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    hosts.some(h => h.group === env.name && h.label.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <>
      <div className="mt-2 min-h-0 flex-1 overflow-hidden rounded-[18px] border border-slate-800/90 bg-slate-900/60 flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Environments
          </p>
          <button 
            type="button"
            onClick={() => {
              setEditingEnv(undefined);
              setIsEditorOpen(true);
            }}
            className="text-slate-400 hover:text-emerald-400 transition"
          >
            +
          </button>
        </div>
        <div className="max-h-full overflow-y-auto overflow-x-hidden p-2 flex-1">
          {filteredEnvs.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] text-slate-500">No environments found.</p>
          )}
          {filteredEnvs.map(env => {
            const envHosts = hosts.filter(h => h.group === env.name);
            const connectedCount = envHosts.filter(h => activeHostIds.has(h.id)).length;
            const isExpanded = expandedEnvs[env.id];
            const isDragOver = draggedOverEnvId === env.id;
            
            return (
              <div 
                key={env.id} 
                className={cn("mb-1 rounded-[14px]", isDragOver && "bg-emerald-400/10 border border-emerald-400/50")}
                onDragOver={(e) => onDragOver(e, env.id)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, env.name)}
              >
                <button 
                  type="button"
                  onClick={() => toggleEnv(env.id)}
                  className="group w-full flex items-center justify-between rounded-[14px] px-2 py-1.5 hover:bg-slate-800/50 transition text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-slate-500 w-3 text-center">{isExpanded ? "▼" : "▶"}</span>
                    <span className="truncate text-[12px] font-medium text-slate-200">{env.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden group-hover:flex gap-1 mr-1">
                      <span onClick={(e) => handleEdit(e, env)} className="text-[10px] text-slate-400 hover:text-emerald-400">✎</span>
                      <span onClick={(e) => handleDelete(e, env.id)} className="text-[10px] text-slate-400 hover:text-rose-400">×</span>
                    </div>
                    <span className="text-[10px] text-slate-500">{envHosts.length} hosts</span>
                    {connectedCount > 0 && (
                      <span className="text-[10px] text-emerald-400">{connectedCount} conn</span>
                    )}
                  </div>
                </button>
                
                {isExpanded && envHosts.length > 0 && (
                  <div className="ml-5 mt-1 space-y-0.5 border-l border-slate-800/50 pl-2 pb-1">
                    {envHosts.map(host => {
                      const isConnected = activeHostIds.has(host.id);
                      return (
                        <div 
                          key={host.id} 
                          draggable
                          onDragStart={(e) => onDragStart(e, host.id)}
                          className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-slate-800/40 cursor-grab active:cursor-grabbing"
                        >
                          <span className="truncate text-[11px] text-slate-300">{host.label}</span>
                          {isConnected && (
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400"></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {isEditorOpen && (
        <EnvironmentEditor
          open={isEditorOpen}
          environment={editingEnv}
          onClose={() => setIsEditorOpen(false)}
          onSave={(values) => {
            if (editingEnv) {
              updateEnvironment(editingEnv.id, values.name, values.type);
            } else {
              createEnvironment(values.name, values.type);
            }
            setIsEditorOpen(false);
          }}
        />
      )}
    </>
  );
}
