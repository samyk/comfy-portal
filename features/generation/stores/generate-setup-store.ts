import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface GenerateSetup {
  id: string;
  name: string;
  serverId?: string;
  workflowId?: string;
  promptNodes?: {
    nodeId: string;
    inputKeys: string[];
  }[];
  isDraft?: boolean;
}

interface GenerateSetupState {
  setups: GenerateSetup[];
  selectedSetupId?: string;
  createSetup: (name?: string, overrides?: Partial<Omit<GenerateSetup, 'id' | 'name'>>) => string;
  removeSetup: (id: string) => void;
  selectSetup: (id: string) => void;
  updateSetup: (id: string, updates: Partial<Omit<GenerateSetup, 'id'>>) => void;
  setServerId: (serverId?: string) => void;
  setWorkflowId: (workflowId?: string) => void;
  addPromptNode: (nodeId: string, inputKeys?: string[]) => void;
  removePromptNode: (nodeId: string) => void;
  addPromptNodeInputKey: (nodeId: string, inputKey: string) => void;
  removePromptNodeInputKey: (nodeId: string, inputKey: string) => void;
  reset: () => void;
}

const createSetup = (name: string, overrides: Partial<GenerateSetup> = {}): GenerateSetup => ({
  id: Crypto.randomUUID(),
  name,
  ...overrides,
});

const ensureSelectedSetupId = (state: Pick<GenerateSetupState, 'setups' | 'selectedSetupId'>) => {
  if (state.selectedSetupId && state.setups.some((setup) => setup.id === state.selectedSetupId)) {
    return state.selectedSetupId;
  }
  return state.setups[0]?.id;
};

const updateSelectedSetup = (
  state: GenerateSetupState,
  updater: (setup: GenerateSetup) => GenerateSetup,
): GenerateSetupState => {
  const selectedSetupId = ensureSelectedSetupId(state);
  if (!selectedSetupId) return state;

  return {
    ...state,
    selectedSetupId,
    setups: state.setups.map((setup) =>
      setup.id === selectedSetupId ? updater(setup) : setup,
    ),
  };
};

const defaultSetup = createSetup('Setup 1');

export const useGenerateSetupStore = create<GenerateSetupState>()(
  persist(
    (set, get) => ({
      setups: [defaultSetup],
      selectedSetupId: defaultSetup.id,

      createSetup: (name, overrides) => {
        const setupName = name?.trim() || `Setup ${get().setups.length + 1}`;
        const newSetup = createSetup(setupName, overrides);
        set((state) => ({
          setups: [...state.setups, newSetup],
          selectedSetupId: newSetup.id,
        }));
        return newSetup.id;
      },

      removeSetup: (id) =>
        set((state) => {
          const remaining = state.setups.filter((setup) => setup.id !== id);
          if (remaining.length === 0) {
            const fallback = createSetup('Setup 1');
            return {
              setups: [fallback],
              selectedSetupId: fallback.id,
            };
          }
          const nextSelected =
            state.selectedSetupId === id
              ? remaining[0]?.id
              : state.selectedSetupId;
          return {
            setups: remaining,
            selectedSetupId: nextSelected,
          };
        }),

      selectSetup: (id) =>
        set((state) => {
          if (!state.setups.some((setup) => setup.id === id)) {
            return state;
          }
          return { selectedSetupId: id };
        }),

      updateSetup: (id, updates) =>
        set((state) => ({
          setups: state.setups.map((setup) =>
            setup.id === id ? { ...setup, ...updates } : setup,
          ),
        })),

      setServerId: (serverId) =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            serverId,
            workflowId: undefined,
            nodeId: undefined,
            inputKeys: undefined,
          })),
        ),

      setWorkflowId: (workflowId) =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            workflowId,
            promptNodes: undefined,
          })),
        ),

      addPromptNode: (nodeId, inputKeys) =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            promptNodes: setup.promptNodes?.some((node) => node.nodeId === nodeId)
              ? setup.promptNodes
              : [
                ...(setup.promptNodes ?? []),
                { nodeId, inputKeys: inputKeys?.length ? inputKeys : [] },
              ],
          })),
        ),

      removePromptNode: (nodeId) =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            promptNodes: (setup.promptNodes ?? []).filter((node) => node.nodeId !== nodeId),
          })),
        ),

      addPromptNodeInputKey: (nodeId, inputKey) =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            promptNodes: (setup.promptNodes ?? []).map((node) =>
              node.nodeId === nodeId
                ? {
                  ...node,
                  inputKeys: node.inputKeys.includes(inputKey)
                    ? node.inputKeys
                    : [...node.inputKeys, inputKey],
                }
                : node,
            ),
          })),
        ),

      removePromptNodeInputKey: (nodeId, inputKey) =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            promptNodes: (setup.promptNodes ?? []).map((node) =>
              node.nodeId === nodeId
                ? {
                  ...node,
                  inputKeys: node.inputKeys.filter((key) => key !== inputKey),
                }
                : node,
            ),
          })),
        ),

      reset: () =>
        set((state) =>
          updateSelectedSetup(state, (setup) => ({
            ...setup,
            serverId: undefined,
            workflowId: undefined,
            promptNodes: undefined,
          })),
        ),
    }),
    {
      name: 'generate-setup-storage',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => {
        const persistedSetups = state.setups.filter((setup) => !setup.isDraft);
        const selectedSetupId = persistedSetups.some((setup) => setup.id === state.selectedSetupId)
          ? state.selectedSetupId
          : persistedSetups[0]?.id;
        return {
          setups: persistedSetups,
          selectedSetupId,
        };
      },
      migrate: (persistedState: any) => {
        if (!persistedState) return persistedState;

        if (Array.isArray(persistedState.setups)) {
          const setups = persistedState.setups.length
            ? persistedState.setups.map(
              (setup: GenerateSetup & { nodeId?: string; inputKeys?: string[] }) => {
              if (!setup.promptNodes && setup.nodeId) {
                return {
                  ...setup,
                  promptNodes: [
                    {
                      nodeId: setup.nodeId,
                      inputKeys: setup.inputKeys ?? [],
                    },
                  ],
                };
              }
              return setup;
              },
            )
            : [createSetup('Setup 1')];
          const selectedSetupId = ensureSelectedSetupId({
            setups,
            selectedSetupId: persistedState.selectedSetupId,
          });
          return {
            ...persistedState,
            setups,
            selectedSetupId,
          } as GenerateSetupState;
        }

        if (
          persistedState.serverId ||
          persistedState.workflowId ||
          persistedState.nodeId ||
          persistedState.inputKey ||
          (Array.isArray(persistedState.inputKeys) && persistedState.inputKeys.length > 0)
        ) {
          const migratedSetup = createSetup('Setup 1', {
            serverId: persistedState.serverId,
            workflowId: persistedState.workflowId,
            promptNodes: persistedState.nodeId
              ? [
                {
                  nodeId: persistedState.nodeId,
                  inputKeys: persistedState.inputKey
                    ? [persistedState.inputKey]
                    : persistedState.inputKeys ?? [],
                },
              ]
              : undefined,
          });
          return {
            setups: [migratedSetup],
            selectedSetupId: migratedSetup.id,
          } as GenerateSetupState;
        }

        const fallback = createSetup('Setup 1');
        return {
          setups: [fallback],
          selectedSetupId: fallback.id,
        } as GenerateSetupState;
      },
    },
  ),
);
