import { useQuickActionStore } from '@/features/quick-action/stores/quick-action-store';
import { useServersStore } from '@/features/server/stores/server-store';
import { useWorkflowStore } from '@/features/workflow/stores/workflow-store';
import { showToast } from '@/utils/toast';
import { useRouter } from 'expo-router';
import { useIncomingShare } from 'expo-sharing';
import React, { Component, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

class IncomingShareErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}

function IncomingShareListenerInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolvedSharedPayloads, clearSharedPayloads, isResolving } = useIncomingShare();

  useEffect(() => {
    if (isResolving || resolvedSharedPayloads.length === 0) return;

    const payload = resolvedSharedPayloads[0];

    if (payload.contentType !== 'image' || !payload.contentUri) {
      clearSharedPayloads();
      return;
    }

    const actions = useQuickActionStore.getState().actions;

    if (actions.length === 0) {
      showToast.error('No Quick Actions configured', 'Create one from a Load Image node first', insets.top + 8);
      clearSharedPayloads();
      return;
    }

    const servers = useServersStore.getState().servers;
    const workflows = useWorkflowStore.getState().workflow;
    const validAction = actions.find(
      (a) => servers.some((s) => s.id === a.serverId) && workflows.some((w) => w.id === a.workflowId),
    );

    if (!validAction) {
      showToast.error('Quick Action target no longer exists', 'Please reconfigure from a Load Image node', insets.top + 8);
      clearSharedPayloads();
      return;
    }

    if (router.canDismiss()) {
      router.dismissAll();
    }

    router.push({
      pathname: '/workflow/[serverId]/run/[workflowId]',
      params: {
        serverId: validAction.serverId,
        workflowId: validAction.workflowId,
        sharedImageUri: payload.contentUri,
        targetNodeId: validAction.targetNodeId,
      },
    });
    clearSharedPayloads();
  }, [clearSharedPayloads, insets.top, isResolving, resolvedSharedPayloads, router]);

  return null;
}

export function IncomingShareListener() {
  return (
    <IncomingShareErrorBoundary>
      <IncomingShareListenerInner />
    </IncomingShareErrorBoundary>
  );
}
