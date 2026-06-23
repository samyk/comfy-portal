import { AppBar } from '@/components/layout/app-bar';
import { SearchableBottomSheet } from '@/components/common/selectors/bottom-sheet';
import { Button, ButtonIcon, ButtonText } from '@/components/ui/button';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { View } from '@/components/ui/view';
import { VStack } from '@/components/ui/vstack';
import { RunPageHeaderStatus } from '@/features/generation/components/run-page-header-status';
import { ZoomableMedia } from '@/features/generation/components/media-preview/zoomable-media';
import { GenerationProvider, useGenerationActions, useGenerationStatus } from '@/features/generation/context/generation-context';
import { useGenerateSetupStore } from '@/features/generation/stores/generate-setup-store';
import { useServersStore } from '@/features/server/stores/server-store';
import { useWorkflowStore } from '@/features/workflow/stores/workflow-store';
import { loadAllHistoryMediaWithPrompt } from '@/services/image-storage';
import { showToast } from '@/utils/toast';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import { ChevronDown, MoreHorizontal, PlayCircle, Save, Share2, Copy, Wand2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Platform, Pressable, TextInput, View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import PagerView from 'react-native-pager-view';
import { Modal, ModalBackdrop, ModalBody, ModalContent } from '@/components/ui/modal';
import { BottomActionPanel } from '@/components/self-ui/bottom-action-panel';

interface PromptHistoryItem {
  url: string;
  prompt?: string;
  timestamp: number;
  serverId?: string;
  workflowId?: string;
}

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const timeParts = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = timeParts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = timeParts.find((part) => part.type === 'minute')?.value ?? '';
  const dayPeriod = timeParts.find((part) => part.type === 'dayPeriod')?.value;
  const suffix = dayPeriod ? ` ${dayPeriod.toLowerCase()}` : '';
  return `${year}/${month}/${day} ${hour}:${minute}${suffix}`;
};

function GenerateScreenContent() {
  const router = useRouter();
  const { openSetup } = useLocalSearchParams<{ openSetup?: string }>();
  const insets = useSafeAreaInsets();
  const { status, generatedMedia } = useGenerationStatus();
  const { generate, stopGenerating } = useGenerationActions();

  const { setups, selectedSetupId, selectSetup, createSetup } = useGenerateSetupStore();
  const servers = useServersStore((state) => state.servers);
  const workflows = useWorkflowStore((state) => state.workflow);

  const isCompleteSetup = useCallback(
    (setup?: typeof setups[number]) =>
      Boolean(
        setup?.serverId &&
          setup?.workflowId &&
          (setup?.promptNodes?.length ?? 0) > 0 &&
          setup?.promptNodes?.some((node) => node.inputKeys.length > 0),
      ),
    [],
  );

  const completeSetups = useMemo(() => setups.filter((setup) => isCompleteSetup(setup)), [setups, isCompleteSetup]);
  const visibleSetups = useMemo(() => setups.filter((setup) => !setup.isDraft), [setups]);
  const selectedSetup = useMemo(
    () => setups.find((setup) => setup.id === selectedSetupId),
    [setups, selectedSetupId],
  );
  const activeSetup = useMemo(
    () => (isCompleteSetup(selectedSetup) ? selectedSetup : completeSetups[0]),
    [selectedSetup, completeSetups, isCompleteSetup],
  );
  const serverId = activeSetup?.serverId;
  const workflowId = activeSetup?.workflowId;
  const promptNodes = activeSetup?.promptNodes ?? [];

  const server = useMemo(() => servers.find((s) => s.id === serverId), [servers, serverId]);
  const workflowRecord = useMemo(
    () => workflows.find((wf) => wf.id === workflowId),
    [workflows, workflowId],
  );
  const [prompt, setPrompt] = useState('');
  const basePromptHeight = 44;
  const [promptHeight, setPromptHeight] = useState(basePromptHeight);
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const setupSheetRef = useRef<BottomSheetModal>(null);
  const [pendingDelete, setPendingDelete] = useState<PromptHistoryItem | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPromptHistoryOpen, setIsPromptHistoryOpen] = useState(false);
  const promptHistorySheetRef = useRef<BottomSheetModal>(null);
  const [isHistoryPreviewOpen, setIsHistoryPreviewOpen] = useState(false);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(0);
  const [showHistoryActions, setShowHistoryActions] = useState(false);

  const isSetupComplete = Boolean(
    server && workflowRecord && promptNodes.length > 0 && promptNodes.some((node) => node.inputKeys.length > 0),
  );

  const ADD_SETUP_VALUE = '__add_setup__';

  const setupOptions = useMemo(
    () =>
      [
        {
          value: ADD_SETUP_VALUE,
          label: 'Add Setup',
          description: 'Create a new setup',
          serverName: 'add-setup',
        },
        ...visibleSetups.map((setup) => {
          const setupServer = servers.find((s) => s.id === setup.serverId);
          const setupWorkflow = workflows.find((wf) => wf.id === setup.workflowId);
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
          const descriptionBase = `${serverName} • ${workflowName}`;
          return {
            value: setup.id,
            label: setup.name || 'Untitled Setup',
            description: nodeDetails ? `${descriptionBase} • ${nodeDetails}` : descriptionBase,
            status: statusLabel,
          };
        }),
      ],
    [visibleSetups, servers, workflows],
  );

  const refreshHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const mediaItems = await loadAllHistoryMediaWithPrompt();
      setHistory(mediaItems);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory, generatedMedia]);

  useEffect(() => {
    if (history.length === 0 && activeHistoryIndex !== 0) {
      setActiveHistoryIndex(0);
      return;
    }
    if (activeHistoryIndex >= history.length) {
      setActiveHistoryIndex(0);
    }
  }, [history.length, activeHistoryIndex]);

  useEffect(() => {
    if (isSetupOpen) {
      setupSheetRef.current?.present();
    } else {
      setupSheetRef.current?.dismiss();
    }
  }, [isSetupOpen]);

  useEffect(() => {
    if (openSetup === '1') {
      setIsSetupOpen(true);
    }
  }, [openSetup]);

  useEffect(() => {
    if (isPromptHistoryOpen) {
      promptHistorySheetRef.current?.present();
    } else {
      promptHistorySheetRef.current?.dismiss();
    }
  }, [isPromptHistoryOpen]);

  useEffect(() => {
    const loadLastPrompt = async () => {
      const lastPrompt = await AsyncStorage.getItem('last-generate-prompt');
      if (lastPrompt) {
        setPrompt(lastPrompt);
      }
    };

    loadLastPrompt().catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!isSetupComplete || !server || !workflowRecord || promptNodes.length === 0) {
      showToast.error('Setup required', 'Please select a server, workflow, and prompt node.', insets.top + 8);
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      showToast.error('Prompt required', 'Please enter a prompt to generate.', insets.top + 8);
      return;
    }

    await AsyncStorage.setItem('last-generate-prompt', trimmedPrompt);

    const workflowCopy = Object.fromEntries(
      Object.entries(workflowRecord.data).map(([id, node]) => [
        id,
        {
          ...node,
          inputs: {
            ...(node.inputs || {}),
          },
        },
      ]),
    );

    for (const promptNode of promptNodes) {
      const targetNode = workflowCopy[promptNode.nodeId];
      if (!targetNode) {
        showToast.error(
          'Node missing',
          'One of the selected prompt nodes is not available in this workflow.',
          insets.top + 8,
        );
        return;
      }

      const nextInputs = { ...(targetNode.inputs || {}) };
      promptNode.inputKeys.forEach((key) => {
        nextInputs[key] = trimmedPrompt;
      });
      targetNode.inputs = nextInputs;
    }

    await generate(workflowCopy, workflowRecord.id, server.id, { prompt: trimmedPrompt });
  };

  const promptHistoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = [];
    for (const item of history) {
      const text = item.prompt?.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      options.push({
        value: text,
        label: text,
        description: formatTimestamp(item.timestamp),
      });
    }
    return options;
  }, [history]);

  const renderPromptHistoryItem = useCallback(
    (option: { value: string; label: string; description?: string }, isSelected: boolean) => (
      <Pressable
        onPress={() => {
          setPrompt(option.value);
          setIsPromptHistoryOpen(false);
        }}
        className="active:opacity-80"
      >
        <RNView
          className={`mx-4 mb-2 overflow-hidden rounded-xl ${isSelected ? 'border-0 bg-background-200' : 'bg-background-50'}`}
        >
          <VStack space="xs" className="p-3">
            <Text className={`text-base ${isSelected ? 'font-medium text-typography-950' : 'text-typography-500'}`}>
              {option.label}
            </Text>
            {option.description && (
              <Text className="text-xs text-background-400">{option.description}</Text>
            )}
          </VStack>
        </RNView>
      </Pressable>
    ),
    [],
  );

  const renderSetupItem = useCallback(
    (
      option: { value: string; label: string; description?: string; status?: string },
      isSelected: boolean,
    ) => {
      const status = option.status ?? 'offline';
      const statusContainerStyles =
        status === 'online'
          ? 'bg-success-500/15'
          : status === 'refreshing'
            ? 'bg-warning-500/15'
            : 'bg-error-500/15';
      const statusTextStyles =
        status === 'online'
          ? 'text-success-600'
          : status === 'refreshing'
            ? 'text-warning-600'
            : 'text-error-600';
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      return (
        <Pressable
          onPress={() => {
            if (option.value === ADD_SETUP_VALUE) {
              const newId = createSetup(undefined, { isDraft: true });
              setIsSetupOpen(false);
              router.push({ pathname: '/generate/setup' as never, params: { draftId: newId } });
              return;
            }
            selectSetup(option.value);
            setIsSetupOpen(false);
          }}
          className="active:opacity-80"
        >
        <RNView
          className={`mx-4 mb-2 overflow-hidden rounded-xl ${isSelected ? 'border-0 bg-background-200' : 'bg-background-50'}`}
        >
          <VStack space="xs" className="p-3">
            <HStack className="items-center justify-between">
              <HStack space="xs" className="items-center flex-1">
                <Text className={`text-base ${isSelected ? 'font-medium text-typography-950' : 'text-typography-500'}`}>
                  {option.label}
                </Text>
                {option.value !== ADD_SETUP_VALUE && (
                  <RNView className={`rounded-full px-2 py-0.5 ${statusContainerStyles}`}>
                    <Text className={`text-[10px] font-semibold ${statusTextStyles}`}>{statusLabel}</Text>
                  </RNView>
                )}
              </HStack>
              {option.value !== ADD_SETUP_VALUE && (
                <Button
                  variant="link"
                  className="h-8 px-2"
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    setIsSetupOpen(false);
                    router.push({ pathname: '/generate/setup' as never, params: { editId: option.value } });
                  }}
                >
                  <ButtonText className="text-xs text-primary-500">Edit</ButtonText>
                </Button>
              )}
            </HStack>
            {option.description && (
              <Text className="text-xs text-background-400">{option.description}</Text>
            )}
          </VStack>
        </RNView>
      </Pressable>
      );
    },
    [createSetup, router, selectSetup],
  );

  const openHistoryPreview = useCallback((index: number) => {
    setActiveHistoryIndex(index);
    setIsHistoryPreviewOpen(true);
  }, []);

  const activeHistoryItem = history[activeHistoryIndex];

  const handleSaveHistoryItem = useCallback(async () => {
    if (!activeHistoryItem?.url) return;
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        showToast.error('Permission needed', 'Please grant permission to save media.', insets.top + 8);
        return;
      }
      await MediaLibrary.saveToLibraryAsync(activeHistoryItem.url);
      showToast.success('Saved to gallery', undefined, insets.top + 8);
      setShowHistoryActions(false);
    } catch (error) {
      console.error('Failed to save media:', error);
      showToast.error('Save Failed', 'Unable to save the media.', insets.top + 8);
    }
  }, [activeHistoryItem, insets.top]);

  const handleShareHistoryItem = useCallback(async () => {
    if (!activeHistoryItem?.url) return;
    try {
      const isShareAvailable = await Sharing.isAvailableAsync();
      if (!isShareAvailable) {
        showToast.error('Share unavailable', 'Sharing is not available on this device.', insets.top + 8);
        return;
      }
      await Sharing.shareAsync(activeHistoryItem.url);
      setShowHistoryActions(false);
    } catch (error) {
      console.error('Failed to share media:', error);
      showToast.error('Share Failed', 'Unable to share the media.', insets.top + 8);
    }
  }, [activeHistoryItem, insets.top]);

  const handleCopyHistoryImage = useCallback(async () => {
    if (!activeHistoryItem?.url) return;
    try {
      await Clipboard.setImageAsync(activeHistoryItem.url);
      showToast.success('Image copied', undefined, insets.top + 8);
      setShowHistoryActions(false);
    } catch (error) {
      console.error('Failed to copy image:', error);
      showToast.error('Copy Failed', 'Unable to copy the image.', insets.top + 8);
    }
  }, [activeHistoryItem, insets.top]);

  const handleCopyHistoryPrompt = useCallback(async () => {
    if (!activeHistoryItem?.prompt) {
      showToast.error('No prompt', 'This image has no saved prompt.', insets.top + 8);
      return;
    }
    await Clipboard.setStringAsync(activeHistoryItem.prompt);
    showToast.success('Prompt copied', undefined, insets.top + 8);
    setShowHistoryActions(false);
  }, [activeHistoryItem, insets.top]);

  const handleDeleteHistoryItem = useCallback(
    async (url: string) => {
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }
      const finalizeDelete = async (targetUrl: string) => {
        try {
          new File(targetUrl).delete();
          try {
            new File(`${targetUrl}.json`).delete();
          } catch {
            // metadata file may not exist
          }
          setAspectRatios((prev) => {
            if (!prev[targetUrl]) return prev;
            const next = { ...prev };
            delete next[targetUrl];
            return next;
          });
          await refreshHistory();
        } catch (error) {
          console.error('Failed to delete history item:', error);
          showToast.error('Delete Failed', 'Failed to delete media.', insets.top + 8);
        }
      };

      if (pendingDelete) {
        await finalizeDelete(pendingDelete.url);
        setPendingDelete(null);
      }

      const deletedItem = history.find((item) => item.url === url);
      if (!deletedItem) return;

      setPendingDelete(deletedItem);
      setHistory((prev) => prev.filter((item) => item.url !== url));

      deleteTimerRef.current = setTimeout(async () => {
        await finalizeDelete(url);
        setPendingDelete(null);
        deleteTimerRef.current = null;
      }, 4000);
    },
    [history, refreshHistory, insets.top, pendingDelete],
  );

  const handleUndoDelete = useCallback(() => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    if (!pendingDelete) return;
    setHistory((prev) => {
      const next = [...prev, pendingDelete];
      return next.sort((a, b) => b.timestamp - a.timestamp);
    });
    setPendingDelete(null);
  }, [pendingDelete]);

  return (
    <View className="flex-1 bg-background-0">
      <AppBar
        title="Generate"
        titleSize="xl"
        centerElement={<RunPageHeaderStatus serverName={server?.name} />}
        rightElement={
          <Button variant="link" className="h-9 rounded-xl px-2" onPress={() => setIsSetupOpen(true)}>
            <HStack space="xs" className="items-center">
              <ButtonText className="text-sm font-medium text-primary-500">
                {selectedSetup?.name || activeSetup?.name || 'Add Setup'}
              </ButtonText>
              <Icon as={ChevronDown} size="xs" className="text-primary-500" />
            </HStack>
          </Button>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <VStack space="sm" className="px-5 pb-4 pt-0">
          <VStack space="xs">
            <View className="relative rounded-xl border border-outline-50 bg-background-50 px-4 py-3">
              <TextInput
                value={prompt}
                onChangeText={(value) => {
                  setPrompt(value);
                  if (!value.trim()) {
                    setPromptHeight(basePromptHeight);
                  }
                }}
                placeholder="describe the image you want to generate"
                placeholderTextColor="#94a3b8"
                multiline
                scrollEnabled={false}
                style={{
                  minHeight: basePromptHeight,
                  height: promptHeight,
                  paddingRight: 28,
                  textAlignVertical: 'top',
                }}
                onContentSizeChange={(event) => {
                  const nextHeight = Math.max(
                    basePromptHeight,
                    Math.ceil(event.nativeEvent.contentSize.height),
                  );
                  if (nextHeight !== promptHeight) {
                    setPromptHeight(nextHeight);
                  }
                }}
                className="text-base text-typography-900"
              />
              <Pressable
                onPress={() => {
                  if (promptHistoryOptions.length === 0) {
                    showToast.error('No history', 'No previous prompts available yet.', insets.top + 8);
                    return;
                  }
                  setIsPromptHistoryOpen(true);
                }}
                className="absolute right-3 top-3 h-6 w-6 items-center justify-center"
              >
                <Icon as={ChevronDown} size="xs" className="text-typography-500" />
              </Pressable>
            </View>
          </VStack>

          <HStack space="sm" className="items-center">
            <Button
              size="xl"
              variant="solid"
              action="primary"
              onPress={() => {
                Keyboard.dismiss();
                handleGenerate();
              }}
              disabled={status === 'generating' || status === 'downloading' || !isSetupComplete}
              className="flex-1 rounded-lg active:bg-primary-600 disabled:opacity-50"
            >
              <ButtonIcon as={Wand2} size="sm" />
              <ButtonText className="text-md font-semibold">
                {status === 'generating' || status === 'downloading' ? 'Generating...' : 'Generate'}
              </ButtonText>
            </Button>
            <Button
              size="xl"
              variant="outline"
              action="negative"
              onPress={() => {
                if (status !== 'generating') return;
                Alert.alert('Stop generation?', 'This will stop the current generation.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Stop',
                    style: 'destructive',
                    onPress: async () => {
                      await stopGenerating();
                    },
                  },
                ]);
              }}
              disabled={status !== 'generating'}
              className="w-28 rounded-lg border border-error-500 bg-transparent disabled:opacity-40"
            >
              <ButtonText className="text-md font-semibold text-error-500">Stop</ButtonText>
            </Button>
          </HStack>

          <VStack space="sm">
            {isLoadingHistory ? (
              <Text className="text-sm text-typography-500">Loading history...</Text>
            ) : history.length === 0 ? (
              <Text className="text-sm text-typography-500">No generations yet.</Text>
            ) : (
              <VStack space="sm">
                {history.map((item, index) => {
                  const isVideo = ['mp4', 'mov', 'm4v', 'webm'].includes(
                    item.url.split('.').pop()?.toLowerCase() || '',
                  );
                  const aspectRatio = aspectRatios[item.url];
                  const itemIndex = index;

                  const card = (
                    <VStack space="sm" className="w-full">
                      <Pressable
                        className="w-full overflow-hidden bg-background-100"
                        onPress={() => openHistoryPreview(itemIndex)}
                      >
                        {isVideo ? (
                          <View className="w-full items-center justify-center" style={{ aspectRatio: 16 / 9 }}>
                            <Icon as={PlayCircle} size="xl" className="text-typography-300" />
                          </View>
                        ) : (
                          <Image
                            source={item.url}
                            style={{ width: '100%', aspectRatio: aspectRatio || 1 }}
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            onLoad={(event) => {
                              const { width, height } = event.source;
                              if (width && height) {
                                setAspectRatios((prev) => ({
                                  ...prev,
                                  [item.url]: width / height,
                                }));
                              }
                            }}
                          />
                        )}
                      </Pressable>
                      <VStack space="xs">
                        <Text className="text-sm text-typography-900">{item.prompt || 'Prompt not saved.'}</Text>
                        <Text className="text-xs text-typography-400">
                          {formatTimestamp(item.timestamp)}
                        </Text>
                      </VStack>
                    </VStack>
                  );

                  if (Platform.OS === 'web') {
                    return <React.Fragment key={`${item.url}-${item.timestamp}`}>{card}</React.Fragment>;
                  }

                  return (
                    <Swipeable
                      key={`${item.url}-${item.timestamp}`}
                      rightThreshold={140}
                      dragOffsetFromRightEdge={64}
                      overshootRight={false}
                      onSwipeableOpen={(direction) => {
                        if (direction === 'right') {
                          handleDeleteHistoryItem(item.url);
                        }
                      }}
                      renderRightActions={() => (
                        <RNView className="w-36 items-end justify-center">
                          <Pressable
                            className="h-full w-36 items-center justify-center bg-error-500"
                            onPress={() => handleDeleteHistoryItem(item.url)}
                          >
                            <Text className="text-sm font-semibold text-white">Delete</Text>
                          </Pressable>
                        </RNView>
                      )}
                    >
                      {card}
                    </Swipeable>
                  );
                })}
              </VStack>
            )}
          </VStack>

          <VStack space="xs" className="rounded-xl border border-outline-50 bg-background-50 px-4 py-3">
            <Text className="text-xs uppercase tracking-widest text-typography-400">Active Setup</Text>
            {isSetupComplete ? (
              <VStack space="xs">
                <Text className="text-sm text-typography-900">Server: {server?.name}</Text>
                <Text className="text-sm text-typography-700">Workflow: {workflowRecord?.name}</Text>
                <Text className="text-sm text-typography-700">
                  Prompt Nodes:{' '}
                  {promptNodes.length > 0
                    ? promptNodes
                      .map((node) => {
                        const nodeMeta = workflowRecord?.data?.[node.nodeId];
                        return nodeMeta?._meta?.title || nodeMeta?.class_type || node.nodeId;
                      })
                      .join(', ')
                    : 'None'}
                </Text>
                <Text className="text-sm text-typography-700">
                  Input Keys:{' '}
                  {promptNodes.length > 0
                    ? promptNodes
                      .map((node) => `${node.nodeId}: ${node.inputKeys.join(', ') || 'None'}`)
                      .join(' • ')
                    : 'None'}
                </Text>
              </VStack>
            ) : (
              <VStack space="xs">
                <Text className="text-sm text-typography-500">No setup selected yet.</Text>
                <Button variant="outline" action="secondary" size="sm" onPress={() => router.push('/generate/setup' as never)}>
                  <ButtonText>Configure Generate Setup</ButtonText>
                </Button>
              </VStack>
            )}
          </VStack>
        </VStack>
      </ScrollView>

      <SearchableBottomSheet
        ref={setupSheetRef}
        isVisible={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        onSelect={(value) => {
          selectSetup(value);
          setIsSetupOpen(false);
        }}
        title="Select Setup"
        options={setupOptions}
        renderItem={renderSetupItem}
        value={selectedSetupId}
        searchPlaceholder="Search setups"
      />

      {pendingDelete && (
        <RNView className="absolute bottom-4 left-0 right-0 px-5">
          <RNView className="flex-row items-center justify-between rounded-xl border border-outline-50 bg-background-0 px-4 py-3 shadow-sm">
            <Text className="text-sm text-typography-900">Item deleted</Text>
            <Pressable onPress={handleUndoDelete} className="px-2 py-1">
              <Text className="text-sm font-medium text-primary-500">Undo</Text>
            </Pressable>
          </RNView>
        </RNView>
      )}

      <SearchableBottomSheet
        ref={promptHistorySheetRef}
        isVisible={isPromptHistoryOpen}
        onClose={() => setIsPromptHistoryOpen(false)}
        onSelect={(value) => {
          setPrompt(value);
          setIsPromptHistoryOpen(false);
        }}
        title="Prompt History"
        options={promptHistoryOptions}
        renderItem={renderPromptHistoryItem}
        value={undefined}
        searchPlaceholder="Search prompts"
      />

      <Modal
        isOpen={isHistoryPreviewOpen}
        onClose={() => {
          setIsHistoryPreviewOpen(false);
          setShowHistoryActions(false);
        }}
        useRNModal={false}
        avoidKeyboard={false}
        closeOnOverlayClick
        size="full"
        style={{ margin: 0, padding: 0 }}
      >
        <ModalBackdrop />
        <ModalContent
          className="m-0 h-full rounded-none border-0 bg-black p-0"
          style={{ shadowColor: 'transparent', elevation: 0 }}
          transition={{ type: 'timing', duration: 250 }}
        >
          <ModalBody
            className="h-full flex-1 p-0"
            contentContainerStyle={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              margin: 0,
            }}
          >
            {isHistoryPreviewOpen && (
              <PagerView
                key={history.map((item) => item.url).join('-')}
                style={{ flex: 1, width: '100%', height: '100%' }}
                initialPage={activeHistoryIndex}
                onPageSelected={(event) => setActiveHistoryIndex(event.nativeEvent.position)}
              >
                {history.map((item, index) => (
                  <View key={`history-preview-${item.url}-${index}`} className="flex-1">
                    <ZoomableMedia
                      mediaUrl={item.url}
                      onClose={() => setIsHistoryPreviewOpen(false)}
                      onLongPress={() => setShowHistoryActions(true)}
                    />
                  </View>
                ))}
              </PagerView>
            )}

            <Pressable
              onPress={() => setIsHistoryPreviewOpen(false)}
              className="absolute left-3 top-3 h-9 w-9 items-center justify-center rounded-lg bg-black/40"
              style={{ marginTop: insets.top }}
            >
              <Icon as={ChevronDown} size="sm" className="text-white rotate-90" />
            </Pressable>

            <Pressable
              onPress={() => setShowHistoryActions(true)}
              className="absolute right-3 top-3 h-9 w-9 items-center justify-center rounded-lg bg-black/40"
              style={{ marginTop: insets.top }}
            >
              <Icon as={MoreHorizontal} size="sm" className="text-white" />
            </Pressable>

            {activeHistoryItem && (
              <View
                className="absolute left-0 right-0 bg-black/60 px-4 py-3"
                style={{ bottom: showHistoryActions ? 140 : insets.bottom + 12 }}
              >
                <Text className="text-sm text-white" numberOfLines={3}>
                  {activeHistoryItem.prompt || 'Prompt not saved.'}
                </Text>
                <Text className="mt-1 text-xs text-white/70">
                  {formatTimestamp(activeHistoryItem.timestamp)}
                </Text>
              </View>
            )}

            {showHistoryActions && (
              <Pressable
                className="absolute inset-0 z-40 bg-black/30"
                onPress={() => setShowHistoryActions(false)}
              />
            )}
            <RNView className="absolute bottom-0 left-0 right-0 z-50">
              <BottomActionPanel isOpen={showHistoryActions}>
                <VStack space="sm">
                  <Button
                    variant="outline"
                    size="lg"
                    onPress={handleSaveHistoryItem}
                    className="h-12 w-full justify-start border-background-100 px-4"
                  >
                    <Icon as={Save} size="sm" className="mr-2 text-primary-500" />
                    <Text className="text-sm text-primary-500">Save Image</Text>
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onPress={handleShareHistoryItem}
                    className="h-12 w-full justify-start border-background-100 px-4"
                  >
                    <Icon as={Share2} size="sm" className="mr-2 text-primary-500" />
                    <Text className="text-sm text-primary-500">Share</Text>
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onPress={handleCopyHistoryImage}
                    className="h-12 w-full justify-start border-background-100 px-4"
                  >
                    <Icon as={Copy} size="sm" className="mr-2 text-primary-500" />
                    <Text className="text-sm text-primary-500">Copy Image</Text>
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onPress={handleCopyHistoryPrompt}
                    className="h-12 w-full justify-start border-background-100 px-4"
                  >
                    <Icon as={Copy} size="sm" className="mr-2 text-primary-500" />
                    <Text className="text-sm text-primary-500">Copy Generator Text</Text>
                  </Button>
                </VStack>
              </BottomActionPanel>
            </RNView>
          </ModalBody>
        </ModalContent>
      </Modal>
    </View>
  );
}

export default function GenerateScreen() {
  return (
    <GenerationProvider>
      <GenerateScreenContent />
    </GenerationProvider>
  );
}
