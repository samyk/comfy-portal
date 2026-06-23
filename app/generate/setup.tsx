import { AppBar } from '@/components/layout/app-bar';
import { SearchableBottomSheet } from '@/components/common/selectors/bottom-sheet';
import { Button, ButtonText } from '@/components/ui/button';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { VStack } from '@/components/ui/vstack';
import { useGenerateSetupStore } from '@/features/generation/stores/generate-setup-store';
import { useServersStore } from '@/features/server/stores/server-store';
import { useWorkflowStore } from '@/features/workflow/stores/workflow-store';
import { Node } from '@/features/workflow/types';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, Plus, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

function getNodeInputKeys(node?: Node) {
  if (!node?.inputs) return [];
  const entries = Object.entries(node.inputs);
  const stringKeys = entries.filter(([, value]) => typeof value === 'string').map(([key]) => key);
  if (stringKeys.length > 0) return stringKeys;
  return entries.map(([key]) => key);
}

function getDefaultInputKey(node?: Node) {
  const keys = getNodeInputKeys(node);
  if (keys.includes('text')) return 'text';
  return keys[0];
}

interface SelectRowProps {
  label: string;
  value?: string;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
}

function SelectRow({ label, value, placeholder, onPress, disabled }: SelectRowProps) {
  return (
    <Pressable
      className={`rounded-xl border border-outline-50 bg-background-50 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}
      onPress={onPress}
      disabled={disabled}
    >
      <HStack space="sm" className="items-center justify-between">
        <VStack space="xs" className="flex-1">
          <Text className="text-xs uppercase tracking-widest text-typography-400">{label}</Text>
          <Text className="text-sm text-typography-900" numberOfLines={1} ellipsizeMode="tail">
            {value || placeholder}
          </Text>
        </VStack>
        <Icon as={ChevronRight} size="sm" className="text-typography-400" />
      </HStack>
    </Pressable>
  );
}

export default function GenerateSetupScreen() {
  const router = useRouter();
  const servers = useServersStore((state) => state.servers);
  const workflows = useWorkflowStore((state) => state.workflow);
  const {
    setups,
    selectedSetupId,
    createSetup,
    selectSetup,
    updateSetup,
    setServerId,
    setWorkflowId,
    addPromptNode,
    removePromptNode,
    addPromptNodeInputKey,
    removePromptNodeInputKey,
    reset,
    removeSetup,
  } = useGenerateSetupStore();

  const activeSetup = useMemo(
    () => setups.find((setup) => setup.id === selectedSetupId) ?? setups[0],
    [setups, selectedSetupId],
  );
  const serverId = activeSetup?.serverId;
  const workflowId = activeSetup?.workflowId;
  const promptNodes = activeSetup?.promptNodes ?? [];
  const { draftId, editId } = useLocalSearchParams<{ draftId?: string; editId?: string }>();
  const isEditing = Boolean(editId);
  const isAdding = Boolean(draftId);

  const [isServerOpen, setIsServerOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [isNodeOpen, setIsNodeOpen] = useState(false);
  const [isInputKeyOpen, setIsInputKeyOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [inputKeyTargetNodeId, setInputKeyTargetNodeId] = useState<string | null>(null);
  const [draftSetupId, setDraftSetupId] = useState<string | null>(null);
  const initialSelectedSetupId = useRef<string | undefined>(selectedSetupId);

  const serverSheetRef = useRef<BottomSheetModal>(null);
  const workflowSheetRef = useRef<BottomSheetModal>(null);
  const nodeSheetRef = useRef<BottomSheetModal>(null);
  const inputKeySheetRef = useRef<BottomSheetModal>(null);
  const setupSheetRef = useRef<BottomSheetModal>(null);

  const serverOptions = useMemo(
    () =>
      servers.map((server) => ({
        value: server.id,
        label: server.name,
        description: `${server.host}:${server.port}`,
      })),
    [servers],
  );

  const setupOptions = useMemo(
    () =>
      setups.map((setup) => {
        const setupServer = servers.find((server) => server.id === setup.serverId);
        const setupWorkflow = workflows.find((workflow) => workflow.id === setup.workflowId);
        const serverName = setupServer?.name ?? 'No server';
        const workflowName = setupWorkflow?.name ?? 'No workflow';
        const statusLabel = setupServer?.status ? setupServer.status : 'offline';
        const nodeDetails = (setup.promptNodes ?? [])
          .map((node) => {
            const nodeMeta = setupWorkflow?.data?.[node.nodeId];
            const nodeLabel = nodeMeta?._meta?.title || nodeMeta?.class_type || node.nodeId;
            const keys = node.inputKeys.length > 0 ? node.inputKeys.join(', ') : 'No keys';
            return `${nodeLabel}: ${keys}`;
          })
          .join(' • ');
        const descriptionBase = `${serverName} • ${workflowName} • ${statusLabel}`;
        return {
          value: setup.id,
          label: setup.name || 'Untitled Setup',
          description: nodeDetails ? `${descriptionBase} • ${nodeDetails}` : descriptionBase,
        };
      }),
    [setups, servers, workflows],
  );

  const workflowOptions = useMemo(
    () =>
      workflows
        .filter((workflow) => workflow.serverId === serverId)
        .map((workflow) => ({
          value: workflow.id,
          label: workflow.name,
          description: workflow.addMethod === 'server-sync' ? 'Synced from server' : 'Local workflow',
        })),
    [workflows, serverId],
  );

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === workflowId),
    [workflows, workflowId],
  );

  const nodeOptions = useMemo(() => {
    if (!selectedWorkflow) return [];
    return Object.entries(selectedWorkflow.data).map(([id, node]) => ({
      value: node.id || id,
      label: node._meta?.title || node.class_type || node.id || id,
      description: node.class_type || 'Custom node',
    }));
  }, [selectedWorkflow]);

  const inputKeyOptions = useMemo(() => {
    if (!selectedWorkflow || !inputKeyTargetNodeId) return [];
    const targetNode = selectedWorkflow.data?.[inputKeyTargetNodeId];
    const keys = getNodeInputKeys(targetNode);
    return keys.map((key) => ({
      value: key,
      label: key,
      description: 'Prompt input field',
    }));
  }, [selectedWorkflow, inputKeyTargetNodeId]);

  const openServer = useCallback(() => {
    setIsServerOpen(true);
    serverSheetRef.current?.present();
  }, []);

  const openSetup = useCallback(() => {
    setIsSetupOpen(true);
    setupSheetRef.current?.present();
  }, []);

  const closeSetup = useCallback(() => {
    setIsSetupOpen(false);
    setupSheetRef.current?.dismiss();
  }, []);

  const closeServer = useCallback(() => {
    setIsServerOpen(false);
    serverSheetRef.current?.dismiss();
  }, []);

  const openWorkflow = useCallback(() => {
    setIsWorkflowOpen(true);
    workflowSheetRef.current?.present();
  }, []);

  const closeWorkflow = useCallback(() => {
    setIsWorkflowOpen(false);
    workflowSheetRef.current?.dismiss();
  }, []);

  const closeNode = useCallback(() => {
    setIsNodeOpen(false);
    nodeSheetRef.current?.dismiss();
  }, []);

  const closeInputKey = useCallback(() => {
    setIsInputKeyOpen(false);
    setInputKeyTargetNodeId(null);
    inputKeySheetRef.current?.dismiss();
  }, []);

  const handleSelectNode = useCallback(
    (value: string) => {
      const nextNode = selectedWorkflow?.data?.[value];
      const defaultKey = getDefaultInputKey(nextNode);
      addPromptNode(value, defaultKey ? [defaultKey] : []);
      closeNode();
    },
    [addPromptNode, selectedWorkflow, closeNode],
  );

  const isSetupComplete = Boolean(
    serverId &&
    workflowId &&
    promptNodes.length > 0 &&
    promptNodes.some((node) => node.inputKeys.length > 0),
  );

  const handleReset = useCallback(() => {
    Alert.alert('Reset setup?', 'This will clear the server, workflow, and prompt nodes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => reset() },
    ]);
  }, [reset]);

  const handleDeleteSetup = useCallback(() => {
    if (!activeSetup) return;
    Alert.alert('Delete setup?', 'This will remove the setup permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeSetup(activeSetup.id);
          router.replace({ pathname: '/generate' as never, params: { openSetup: '1' } });
        },
      },
    ]);
  }, [activeSetup, removeSetup, router]);

  const handleAddPromptNode = useCallback(() => {
    setIsNodeOpen(true);
    nodeSheetRef.current?.present();
  }, []);

  const handleAddInputKey = useCallback((nodeId: string) => {
    setInputKeyTargetNodeId(nodeId);
    setIsInputKeyOpen(true);
    inputKeySheetRef.current?.present();
  }, []);

  const handleDone = useCallback(() => {
    if (!activeSetup) return;
    if (activeSetup.isDraft) {
      updateSetup(activeSetup.id, { isDraft: false });
      setDraftSetupId(null);
    }
    router.back();
  }, [activeSetup, updateSetup, router]);

  useEffect(() => {
    if (draftId) {
      setDraftSetupId(draftId);
    }
  }, [draftId]);

  useEffect(() => {
    if (editId && setups.some((setup) => setup.id === editId)) {
      selectSetup(editId);
    }
  }, [editId, setups, selectSetup]);

  useEffect(() => {
    return () => {
      if (!draftSetupId) return;
      const draftSetup = setups.find((setup) => setup.id === draftSetupId);
      if (!draftSetup) return;
      removeSetup(draftSetupId);
      if (initialSelectedSetupId.current && initialSelectedSetupId.current !== draftSetupId) {
        selectSetup(initialSelectedSetupId.current);
      }
    };
  }, [draftSetupId, removeSetup, selectSetup, setups]);

  return (
    <View className="flex-1 bg-background-0">
      <AppBar showBack title="Generate Setup" titleSize="xl" />
      <ScrollView className="flex-1">
        <VStack space="md" className="px-5 py-4">
          {!isEditing && !isAdding && (
            <>
              <Text className="text-sm text-typography-500">
                Choose a server workflow and the prompt nodes to drive the Generate screen.
              </Text>

              <SelectRow
                label="Setup"
                value={activeSetup?.name}
                placeholder="Select setup"
                onPress={openSetup}
                disabled={setups.length === 0}
              />
            </>
          )}

          <VStack space="sm">
            <Text className="text-xs uppercase tracking-widest text-typography-400">Setup Name</Text>
            <Input
              variant="outline"
              size="md"
              className="h-11 rounded-xl border border-outline-50 bg-background-50"
            >
              <InputField
                placeholder="Name this setup"
                value={activeSetup?.name ?? ''}
                onChangeText={(text) => {
                  if (!activeSetup) return;
                  updateSetup(activeSetup.id, { name: text });
                }}
                className="text-sm"
              />
            </Input>
            {!isEditing && !isAdding && (
              <Button
                variant="outline"
                action="secondary"
                size="sm"
                onPress={() => {
                  initialSelectedSetupId.current = selectedSetupId;
                  const newId = createSetup(undefined, { isDraft: true });
                  setDraftSetupId(newId);
                }}
                className="h-10 rounded-xl"
              >
                <HStack space="xs" className="items-center">
                  <Icon as={Plus} size="sm" className="text-typography-600" />
                  <ButtonText className="text-sm">New Setup</ButtonText>
                </HStack>
              </Button>
            )}
          </VStack>

          <SelectRow
            label="Server"
            value={servers.find((server) => server.id === serverId)?.name}
            placeholder={servers.length > 0 ? 'Select server' : 'No servers available'}
            onPress={openServer}
            disabled={servers.length === 0}
          />

          <SelectRow
            label="Workflow"
            value={selectedWorkflow?.name}
            placeholder={serverId ? 'Select workflow' : 'Select a server first'}
            onPress={openWorkflow}
            disabled={!serverId || workflowOptions.length === 0}
          />

          <SelectRow
            label="Add Prompt Node"
            value={undefined}
            placeholder={workflowId ? 'Select prompt node' : 'Select a workflow first'}
            onPress={handleAddPromptNode}
            disabled={!workflowId || nodeOptions.length === 0}
          />

          <VStack space="xs">
            <Text className="text-xs uppercase tracking-widest text-typography-400">Prompt Nodes</Text>
            {promptNodes.length === 0 ? (
              <Text className="text-sm text-typography-500">No prompt nodes selected.</Text>
            ) : (
              <VStack space="sm">
                {promptNodes.map((node) => {
                  const nodeMeta = selectedWorkflow?.data?.[node.nodeId];
                  const nodeLabel =
                    nodeMeta?._meta?.title || nodeMeta?.class_type || node.nodeId;
                  return (
                    <VStack
                      key={node.nodeId}
                      space="xs"
                      className="rounded-lg border border-outline-50 bg-background-50 px-3 py-2"
                    >
                      <HStack space="xs" className="items-center justify-between">
                        <Text className="text-sm text-typography-900">{nodeLabel}</Text>
                        <HStack space="xs" className="items-center">
                          <Button
                            variant="link"
                            className="h-7 w-7 rounded-full p-0"
                            onPress={() => handleAddInputKey(node.nodeId)}
                          >
                            <Icon as={Plus} size="xs" className="text-primary-500" />
                          </Button>
                          <Button
                            variant="link"
                            className="h-7 w-7 rounded-full p-0"
                            onPress={() => removePromptNode(node.nodeId)}
                          >
                            <Icon as={Trash2} size="xs" className="text-error-500" />
                          </Button>
                        </HStack>
                      </HStack>
                      {node.inputKeys.length === 0 ? (
                        <Text className="text-sm text-typography-500">No input keys selected.</Text>
                      ) : (
                        <VStack space="xs">
                          {node.inputKeys.map((key) => (
                            <HStack
                              key={`${node.nodeId}-${key}`}
                              space="xs"
                              className="items-center justify-between rounded-lg border border-outline-50 bg-background-0 px-3 py-2"
                            >
                              <Text className="text-sm text-typography-900">{key}</Text>
                              <Button
                                variant="link"
                                className="h-7 w-7 rounded-full p-0"
                                onPress={() => removePromptNodeInputKey(node.nodeId, key)}
                              >
                                <Icon as={Trash2} size="xs" className="text-error-500" />
                              </Button>
                            </HStack>
                          ))}
                        </VStack>
                      )}
                    </VStack>
                  );
                })}
              </VStack>
            )}
          </VStack>

          <HStack space="sm" className="items-center">
            <Button variant="outline" action="secondary" onPress={handleReset} className="flex-1">
              <ButtonText>Reset Setup</ButtonText>
            </Button>
            <Button variant="outline" action="secondary" onPress={handleDeleteSetup} className="flex-1">
              <ButtonText>Delete Setup</ButtonText>
            </Button>
          </HStack>

          {/* Intentionally no helper text when setup is incomplete. */}

          <Button
            variant="solid"
            action="primary"
            onPress={handleDone}
            disabled={!isSetupComplete}
            className="disabled:opacity-40"
          >
            <ButtonText>Done</ButtonText>
          </Button>
        </VStack>
      </ScrollView>

      <SearchableBottomSheet
        ref={serverSheetRef}
        isVisible={isServerOpen}
        onClose={closeServer}
        onSelect={(value) => {
          setServerId(value);
          closeServer();
        }}
        title="Select Server"
        options={serverOptions}
        value={serverId}
        searchPlaceholder="Search servers"
      />

      <SearchableBottomSheet
        ref={setupSheetRef}
        isVisible={isSetupOpen}
        onClose={closeSetup}
        onSelect={(value) => {
          selectSetup(value);
          closeSetup();
        }}
        title="Select Setup"
        options={setupOptions}
        value={activeSetup?.id}
        searchPlaceholder="Search setups"
      />

      <SearchableBottomSheet
        ref={workflowSheetRef}
        isVisible={isWorkflowOpen}
        onClose={closeWorkflow}
        onSelect={(value) => {
          setWorkflowId(value);
          closeWorkflow();
        }}
        title="Select Workflow"
        options={workflowOptions}
        value={workflowId}
        searchPlaceholder="Search workflows"
      />

      <SearchableBottomSheet
        ref={nodeSheetRef}
        isVisible={isNodeOpen}
        onClose={closeNode}
        onSelect={handleSelectNode}
        title="Select Prompt Node"
        options={nodeOptions}
        value={undefined}
        searchPlaceholder="Search nodes"
      />

      <SearchableBottomSheet
        ref={inputKeySheetRef}
        isVisible={isInputKeyOpen}
        onClose={closeInputKey}
        onSelect={(value) => {
          if (inputKeyTargetNodeId) {
            addPromptNodeInputKey(inputKeyTargetNodeId, value);
          }
          closeInputKey();
        }}
        title="Select Input Key"
        options={inputKeyOptions.filter((option) => {
          if (!inputKeyTargetNodeId) return true;
          const targetNode = promptNodes.find((node) => node.nodeId === inputKeyTargetNodeId);
          return !targetNode?.inputKeys.includes(option.value);
        })}
        value={undefined}
        showSearch={false}
      />
    </View>
  );
}
