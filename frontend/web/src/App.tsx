import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface CarbonFootprintData {
  id: number;
  name: string;
  category: string;
  carbonValue: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  level?: string;
}

interface CarbonStats {
  totalEntries: number;
  averageLevel: string;
  todayCount: number;
  verifiedCount: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [footprints, setFootprints] = useState<CarbonFootprintData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingFootprint, setCreatingFootprint] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newFootprintData, setNewFootprintData] = useState({ 
    name: "", 
    category: "transport", 
    carbonValue: "" 
  });
  const [selectedFootprint, setSelectedFootprint] = useState<CarbonFootprintData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<CarbonStats>({
    totalEntries: 0,
    averageLevel: "Low",
    todayCount: 0,
    verifiedCount: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const addToHistory = (action: string) => {
    setOperationHistory(prev => [`${new Date().toLocaleTimeString()}: ${action}`, ...prev.slice(0, 9)]);
  };

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
        addToHistory("FHEVM initialized successfully");
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const calculateCarbonLevel = (value: number): string => {
    if (value < 10) return "Low";
    if (value < 30) return "Medium";
    if (value < 50) return "High";
    return "Very High";
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const footprintsList: CarbonFootprintData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const decryptedValue = Number(businessData.decryptedValue) || 0;
          const level = businessData.isVerified ? calculateCarbonLevel(decryptedValue) : "Unknown";
          
          footprintsList.push({
            id: parseInt(businessId.replace('carbon-', '')) || Date.now(),
            name: businessData.name,
            category: "activity",
            carbonValue: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: decryptedValue,
            level: level
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setFootprints(footprintsList);
      updateStats(footprintsList);
      addToHistory(`Loaded ${footprintsList.length} carbon footprints`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: CarbonFootprintData[]) => {
    const totalEntries = data.length;
    const verifiedCount = data.filter(f => f.isVerified).length;
    const todayCount = data.filter(f => 
      new Date(f.timestamp * 1000).toDateString() === new Date().toDateString()
    ).length;
    
    const verifiedData = data.filter(f => f.isVerified && f.decryptedValue);
    const avgValue = verifiedData.length > 0 ? 
      verifiedData.reduce((sum, f) => sum + (f.decryptedValue || 0), 0) / verifiedData.length : 0;
    
    setStats({
      totalEntries,
      averageLevel: calculateCarbonLevel(avgValue),
      todayCount,
      verifiedCount
    });
  };

  const createFootprint = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingFootprint(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating carbon footprint with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const carbonValue = parseInt(newFootprintData.carbonValue) || 0;
      const businessId = `carbon-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, carbonValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newFootprintData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        `Carbon footprint: ${newFootprintData.category}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon footprint created successfully!" });
      addToHistory(`Created footprint: ${newFootprintData.name}`);
      
      await loadData();
      setShowCreateModal(false);
      setNewFootprintData({ name: "", category: "transport", carbonValue: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingFootprint(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Decrypted carbon value: ${clearValue}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon data decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecryptFootprint = async (footprint: CarbonFootprintData) => {
    const decrypted = await decryptData(footprint.carbonValue);
    if (decrypted !== null) {
      setDecryptedData(decrypted);
      setSelectedFootprint({...footprint, decryptedValue: decrypted, level: calculateCarbonLevel(decrypted)});
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        if (available) {
          setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
          addToHistory("Tested contract availability - Success");
        }
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract test failed" });
    }
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
  };

  const renderCarbonChart = (footprint: CarbonFootprintData) => {
    const value = footprint.decryptedValue || decryptedData || 0;
    const level = calculateCarbonLevel(value);
    
    return (
      <div className="carbon-chart">
        <div className="chart-levels">
          <div className={`level low ${level === "Low" ? "active" : ""}`}>
            <div className="level-bar"></div>
            <span>Low</span>
          </div>
          <div className={`level medium ${level === "Medium" ? "active" : ""}`}>
            <div className="level-bar"></div>
            <span>Medium</span>
          </div>
          <div className={`level high ${level === "High" ? "active" : ""}`}>
            <div className="level-bar"></div>
            <span>High</span>
          </div>
          <div className={`level very-high ${level === "Very High" ? "active" : ""}`}>
            <div className="level-bar"></div>
            <span>Very High</span>
          </div>
        </div>
        <div className="current-level">
          <div className={`level-indicator ${level.toLowerCase().replace(' ', '-')}`}>
            {level}
          </div>
        </div>
      </div>
    );
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <h3>Total Entries</h3>
          <div className="stat-value">{stats.totalEntries}</div>
          <div className="stat-trend">+{stats.todayCount} today</div>
        </div>
        
        <div className="stat-card neon-blue">
          <h3>Average Level</h3>
          <div className="stat-value">{stats.averageLevel}</div>
          <div className="stat-trend">Carbon Intensity</div>
        </div>
        
        <div className="stat-card neon-pink">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedCount}/{stats.totalEntries}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🌿 CarbonFoot_Z</h1>
            <p>Confidential Carbon Footprint Tracker</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Start Tracking</h2>
            <p>Protect your carbon data with FHE encryption while contributing to environmental awareness.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet securely</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Track carbon footprint privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your carbon data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading carbon footprint data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🌿 CarbonFoot_Z</h1>
          <p>FHE-Protected Carbon Tracking</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Footprint
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Carbon Footprint Dashboard</h2>
          {renderStats()}
        </div>
        
        <div className="content-grid">
          <div className="footprints-section">
            <div className="section-header">
              <h2>Your Carbon Footprints</h2>
              <div className="header-actions">
                <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="footprints-list">
              {footprints.length === 0 ? (
                <div className="no-data">
                  <p>No carbon footprints recorded yet</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Record First Footprint
                  </button>
                </div>
              ) : footprints.map((footprint, index) => (
                <div 
                  className={`footprint-item ${selectedFootprint?.id === footprint.id ? "selected" : ""}`}
                  key={index}
                  onClick={() => setSelectedFootprint(footprint)}
                >
                  <div className="footprint-header">
                    <div className="footprint-name">{footprint.name}</div>
                    <div className={`footprint-level ${footprint.level?.toLowerCase().replace(' ', '-')}`}>
                      {footprint.level}
                    </div>
                  </div>
                  <div className="footprint-meta">
                    <span>{new Date(footprint.timestamp * 1000).toLocaleDateString()}</span>
                    <span>{footprint.isVerified ? "✅ Verified" : "🔓 Encrypted"}</span>
                  </div>
                  <div className="footprint-actions">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDecryptFootprint(footprint);
                      }}
                      className={`decrypt-btn ${footprint.isVerified ? 'verified' : ''}`}
                      disabled={isDecrypting}
                    >
                      {footprint.isVerified ? "Verified" : "Decrypt"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="side-panel">
            <div className="history-section">
              <h3>Operation History</h3>
              <div className="history-list">
                {operationHistory.map((entry, index) => (
                  <div key={index} className="history-item">
                    {entry}
                  </div>
                ))}
              </div>
            </div>
            
            {selectedFootprint && (
              <div className="detail-section">
                <h3>Footprint Details</h3>
                <div className="detail-content">
                  <div className="detail-item">
                    <label>Activity:</label>
                    <span>{selectedFootprint.name}</span>
                  </div>
                  <div className="detail-item">
                    <label>Date:</label>
                    <span>{new Date(selectedFootprint.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="detail-item">
                    <label>Status:</label>
                    <span>{selectedFootprint.isVerified ? "On-chain Verified" : "FHE Encrypted"}</span>
                  </div>
                  {(selectedFootprint.isVerified || decryptedData) && (
                    <>
                      <div className="detail-item">
                        <label>Carbon Value:</label>
                        <span>{selectedFootprint.decryptedValue || decryptedData}</span>
                      </div>
                      {renderCarbonChart(selectedFootprint)}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Record Carbon Footprint</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Protection</strong>
                <p>Carbon value will be encrypted using homomorphic encryption</p>
              </div>
              
              <div className="form-group">
                <label>Activity Name</label>
                <input 
                  type="text" 
                  value={newFootprintData.name}
                  onChange={(e) => setNewFootprintData({...newFootprintData, name: e.target.value})}
                  placeholder="e.g., Daily commute, Grocery shopping"
                />
              </div>
              
              <div className="form-group">
                <label>Category</label>
                <select 
                  value={newFootprintData.category}
                  onChange={(e) => setNewFootprintData({...newFootprintData, category: e.target.value})}
                >
                  <option value="transport">Transportation</option>
                  <option value="food">Food</option>
                  <option value="energy">Energy</option>
                  <option value="shopping">Shopping</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Carbon Value (Integer)</label>
                <input 
                  type="number" 
                  value={newFootprintData.carbonValue}
                  onChange={(e) => setNewFootprintData({...newFootprintData, carbonValue: e.target.value})}
                  placeholder="Enter carbon value..."
                  min="0"
                  step="1"
                />
                <div className="input-note">FHE Encrypted Integer</div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createFootprint}
                disabled={creatingFootprint || isEncrypting || !newFootprintData.name || !newFootprintData.carbonValue}
                className="submit-btn"
              >
                {creatingFootprint || isEncrypting ? "Encrypting..." : "Record Footprint"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

