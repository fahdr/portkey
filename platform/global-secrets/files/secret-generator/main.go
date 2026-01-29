package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"

	"github.com/sethvargo/go-password/password"
	"gopkg.in/yaml.v2"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

const namespace = "global-secrets"

type RandomSecret struct {
	Name          string   `yaml:"name"`
	SyncTo        []string `yaml:"syncTo,omitempty"`        // ["kubernetes", "vaultwarden"]
	SyncDirection string   `yaml:"syncDirection,omitempty"` // "kubernetes-to-vaultwarden", "vaultwarden-to-kubernetes", "bidirectional"
	Data          []struct {
		Key     string `yaml:"key"`
		Length  int    `yaml:"length"`
		Special bool   `yaml:"special"`
	} `yaml:"data"`
}

type VaultwardenItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Notes  string `json:"notes"`
	Fields []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
		Type  int    `json:"type"` // 0 = text, 1 = hidden
	} `json:"fields"`
}

func getClient() (*kubernetes.Clientset, error) {
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	overrides := &clientcmd.ConfigOverrides{}

	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("Error building client config: %v", err)
	}

	return kubernetes.NewForConfig(config)
}

func generateRandomPassword(length int, special bool) (string, error) {
	numDigits := int(math.Ceil(float64(length) * 0.2))
	numSymbols := 0

	if special {
		numSymbols = int(math.Ceil(float64(length) * 0.2))
	}

	return password.Generate(length, numDigits, numSymbols, false, true)
}

func getVaultwardenItem(secretName string) (*VaultwardenItem, error) {
	// Use the correct Bitwarden CLI API endpoint
	webhookURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item/" + secretName
	
	req, err := http.NewRequest("GET", webhookURL, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating webhook request: %v", err)
	}
	
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error sending webhook request: %v", err)
	}
	defer resp.Body.Close()
	
	// Read response body for logging
	responseBody := make([]byte, 1024) // Read first 1KB for logging
	n, _ := resp.Body.Read(responseBody)
	responseStr := string(responseBody[:n])
	
	log.Printf("GET item '%s' - Status: %d, Response: %s", secretName, resp.StatusCode, responseStr)
	
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil // Item not found
	}
	
	if resp.StatusCode == http.StatusBadRequest {
		// This might indicate multiple items with the same name - we can get the IDs directly from the response
		log.Printf("⚠️  WARNING: GET returned 400 for item '%s' - this usually means multiple items with same name exist", secretName)
		
		// Parse the response to get the IDs
		var errorResponse struct {
			Success bool     `json:"success"`
			Message string   `json:"message"`
			Data    []string `json:"data"`
		}
		
		if err := json.Unmarshal(responseBody[:n], &errorResponse); err == nil && len(errorResponse.Data) > 0 {
			log.Printf("⚠️  WARNING: Found %d duplicate items with IDs: %v", len(errorResponse.Data), errorResponse.Data)
			log.Printf("⚠️  WARNING: Attempting to clean up duplicates using IDs from error response")
			
			// Clean up duplicates using the IDs we got from the error response
			err := cleanupDuplicateItemsByIDs(secretName, errorResponse.Data)
			if err != nil {
				log.Printf("⚠️  ERROR: Failed to cleanup duplicates for '%s': %v", secretName, err)
				return nil, fmt.Errorf("multiple items found and cleanup failed: %v", err)
			}
			
			// After cleanup, try to get the item again
			return getVaultwardenItemAfterCleanup(secretName)
		} else {
			// Fallback to the old method if we can't parse the IDs
			log.Printf("⚠️  WARNING: Could not parse IDs from error response, falling back to list method")
			err := cleanupDuplicateItems(secretName)
			if err != nil {
				log.Printf("⚠️  ERROR: Failed to cleanup duplicates for '%s': %v", secretName, err)
				return nil, fmt.Errorf("multiple items found and cleanup failed: %v", err)
			}
			
			// After cleanup, try to get the item again
			return getVaultwardenItemAfterCleanup(secretName)
		}
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("webhook returned status %d: %s", resp.StatusCode, responseStr)
	}
	
	// Parse the structured response from Bitwarden CLI API
	var apiResponse struct {
		Success bool            `json:"success"`
		Message string          `json:"message"`
		Data    VaultwardenItem `json:"data"`
	}
	
	if err := json.Unmarshal(responseBody[:n], &apiResponse); err != nil {
		return nil, fmt.Errorf("error decoding webhook response: %v", err)
	}
	
	if !apiResponse.Success {
		return nil, fmt.Errorf("API returned success=false: %s", apiResponse.Message)
	}
	
	return &apiResponse.Data, nil
}

func getVaultwardenSecretData(item *VaultwardenItem) map[string]string {
	secretData := make(map[string]string)
	
	if item == nil {
		return secretData
	}
	
	for _, field := range item.Fields {
		secretData[field.Name] = field.Value
	}
	
	return secretData
}

func getFieldNames(existingFields []struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Type  int    `json:"type"`
}, managedSecrets map[string]string) []string {
	var extraFields []string
	
	for _, field := range existingFields {
		// If this field is not in our managed secrets, it's an extra field that will be lost
		if _, isManaged := managedSecrets[field.Name]; !isManaged {
			extraFields = append(extraFields, field.Name)
		}
	}
	
	return extraFields
}

func cleanupDuplicateItemsByIDs(secretName string, itemIDs []string) error {
	if len(itemIDs) <= 1 {
		return nil // No duplicates to clean up
	}
	
	client := &http.Client{}
	
	// Keep the first item and delete the rest
	for i := 1; i < len(itemIDs); i++ {
		deleteURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item/" + itemIDs[i]
		deleteReq, err := http.NewRequest("DELETE", deleteURL, nil)
		if err != nil {
			log.Printf("Error creating delete request for duplicate item %s: %v", itemIDs[i], err)
			continue
		}
		
		deleteResp, err := client.Do(deleteReq)
		if err != nil {
			log.Printf("Error deleting duplicate item %s: %v", itemIDs[i], err)
			continue
		}
		
		// Read delete response for logging
		deleteBody := make([]byte, 512)
		dn, _ := deleteResp.Body.Read(deleteBody)
		deleteRespStr := string(deleteBody[:dn])
		deleteResp.Body.Close()
		
		log.Printf("Delete duplicate item %s - Status: %d, Response: %s", itemIDs[i], deleteResp.StatusCode, deleteRespStr)
		
		if deleteResp.StatusCode == http.StatusOK || deleteResp.StatusCode == http.StatusNoContent {
			log.Printf("Successfully deleted duplicate item '%s' (ID: %s)", secretName, itemIDs[i])
		} else {
			log.Printf("Failed to delete duplicate item %s: status %d", itemIDs[i], deleteResp.StatusCode)
		}
	}
	
	log.Printf("Cleanup complete for '%s' - kept ID %s, deleted %d duplicates", secretName, itemIDs[0], len(itemIDs)-1)
	return nil
}


// currently using api_token to access vaultwarden-cli API which does not have permissions to delete items
// Switch to using user and password to enable delete. Until then manually delete duplicates via the CLI/UI
func cleanupDuplicateItems(secretName string) error {
	// Get all items to find duplicates
	listURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/list/object/items"
	
	req, err := http.NewRequest("GET", listURL, nil)
	if err != nil {
		return fmt.Errorf("error creating list request: %v", err)
	}
	
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error sending list request: %v", err)
	}
	defer resp.Body.Close()
	
	// Read response body for logging
	responseBody := make([]byte, 2048) // Read more for list response
	n, _ := resp.Body.Read(responseBody)
	responseStr := string(responseBody[:n])
	
	log.Printf("List items response - Status: %d, Response: %s", resp.StatusCode, responseStr)
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("list request failed with status %d", resp.StatusCode)
	}
	
	// Parse the response structure based on what we see in the API
	var listResponse struct {
		Success bool                `json:"success"`
		Message string              `json:"message"`
		Data    []VaultwardenItem   `json:"data"`
	}
	
	if err := json.Unmarshal(responseBody[:n], &listResponse); err != nil {
		// If the structured response fails, let's try to see if it's a direct array
		var items []VaultwardenItem
		if err2 := json.Unmarshal(responseBody[:n], &items); err2 != nil {
			return fmt.Errorf("error decoding list response (tried both formats): structured=%v, array=%v", err, err2)
		}
		listResponse.Data = items
	}
	
	// Find all items with the same name
	var duplicates []VaultwardenItem
	for _, item := range listResponse.Data {
		if item.Name == secretName {
			duplicates = append(duplicates, item)
		}
	}
	
	log.Printf("Found %d items with name '%s'", len(duplicates), secretName)
	
	if len(duplicates) <= 1 {
		return nil // No duplicates to clean up
	}
	
	// Keep the first item and delete the rest
	for i := 1; i < len(duplicates); i++ {
		deleteURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item/" + duplicates[i].ID
		deleteReq, err := http.NewRequest("DELETE", deleteURL, nil)
		if err != nil {
			log.Printf("Error creating delete request for duplicate item %s: %v", duplicates[i].ID, err)
			continue
		}
		
		deleteResp, err := client.Do(deleteReq)
		if err != nil {
			log.Printf("Error deleting duplicate item %s: %v", duplicates[i].ID, err)
			continue
		}
		deleteResp.Body.Close()
		
		if deleteResp.StatusCode == http.StatusOK || deleteResp.StatusCode == http.StatusNoContent {
			log.Printf("Successfully deleted duplicate item '%s' (ID: %s)", secretName, duplicates[i].ID)
		} else {
			log.Printf("Failed to delete duplicate item %s: status %d", duplicates[i].ID, deleteResp.StatusCode)
		}
	}
	
	return nil
}

func getVaultwardenItemAfterCleanup(secretName string) (*VaultwardenItem, error) {
	// Try to get the item again after cleanup
	webhookURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item/" + secretName
	
	req, err := http.NewRequest("GET", webhookURL, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating webhook request: %v", err)
	}
	
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error sending webhook request: %v", err)
	}
	defer resp.Body.Close()
	
	// Read response body for logging
	responseBody := make([]byte, 1024)
	n, _ := resp.Body.Read(responseBody)
	responseStr := string(responseBody[:n])
	
	log.Printf("GET item '%s' after cleanup - Status: %d, Response: %s", secretName, resp.StatusCode, responseStr)
	
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil // Item not found after cleanup
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("webhook returned status %d after cleanup: %s", resp.StatusCode, responseStr)
	}
	
	// Parse the structured response from Bitwarden CLI API
	var apiResponse struct {
		Success bool            `json:"success"`
		Message string          `json:"message"`
		Data    VaultwardenItem `json:"data"`
	}
	
	if err := json.Unmarshal(responseBody[:n], &apiResponse); err != nil {
		return nil, fmt.Errorf("error decoding webhook response: %v", err)
	}
	
	if !apiResponse.Success {
		return nil, fmt.Errorf("API returned success=false after cleanup: %s", apiResponse.Message)
	}
	
	return &apiResponse.Data, nil
}

func syncToVaultwarden(secretName string, secretData map[string]string) error {
	// First, check if the item already exists
	existingItem, err := getVaultwardenItem(secretName)
	if err != nil {
		return fmt.Errorf("error checking for existing item: %v", err)
	}
	
	log.Printf("🔍 DEBUG: existingItem result for '%s': %+v", secretName, existingItem)
	if existingItem != nil {
		log.Printf("🔍 DEBUG: existingItem.ID = '%s', existingItem.Name = '%s'", existingItem.ID, existingItem.Name)
	}
	
	// Create Bitwarden item in the format expected by the CLI API
	// This matches the template from `bw get template item`
	item := map[string]interface{}{
		"organizationId": nil,
		"folderId":       nil,
		"type":           2, // Secure Note type
		"name":           secretName,
		"notes":          fmt.Sprintf("Generated by secret-generator for %s", secretName),
		"favorite":       false,
		"secureNote": map[string]interface{}{
			"type": 0, // Generic secure note
		},
		"fields": []map[string]interface{}{},
		"login":    nil,
		"card":     nil,
		"identity": nil,
	}
	
	// If we're updating an existing item, preserve its existing fields and update/add our managed fields
	if existingItem != nil {
		// Start with existing fields to preserve any manually added fields
		existingFields := make(map[string]map[string]interface{})
		for _, field := range existingItem.Fields {
			existingFields[field.Name] = map[string]interface{}{
				"name":  field.Name,
				"value": field.Value,
				"type":  field.Type,
			}
		}
		
		// Update/add our managed secret fields (this will overwrite existing ones with same name)
		for key, value := range secretData {
			existingFields[key] = map[string]interface{}{
				"name":  key,
				"value": value,
				"type":  1, // Hidden field type
			}
		}
		
		// Convert back to slice for the API
		fieldsSlice := make([]map[string]interface{}, 0, len(existingFields))
		for _, field := range existingFields {
			fieldsSlice = append(fieldsSlice, field)
		}
		item["fields"] = fieldsSlice
		
		// Preserve other existing item properties if they exist
		if existingItem.Notes != "" {
			item["notes"] = existingItem.Notes
		}
	} else {
		// New item, just add our secret fields
		for key, value := range secretData {
			field := map[string]interface{}{
				"name":  key,
				"value": value,
				"type":  1, // Hidden field type
			}
			item["fields"] = append(item["fields"].([]map[string]interface{}), field)
		}
	}
	
	// Marshal to JSON
	jsonData, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("error marshaling item to JSON: %v", err)
	}
	
	var webhookURL string
	var method string
	
	log.Printf("🔍 DEBUG: Checking condition - existingItem != nil: %v, existingItem.ID != \"\": %v", 
		existingItem != nil, 
		existingItem != nil && existingItem.ID != "")
	
	if existingItem != nil && existingItem.ID != "" {
		// Item exists, update it using PUT with the item ID
		webhookURL = "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item/" + existingItem.ID
		method = "PUT"
		// Include the ID in the item for updates
		item["id"] = existingItem.ID
		// Re-marshal with ID
		jsonData, err = json.Marshal(item)
		if err != nil {
			return fmt.Errorf("error marshaling item with ID to JSON: %v", err)
		}
		log.Printf("🔄 UPDATE: Updating existing Vaultwarden item '%s' (ID: %s) using %s %s", secretName, existingItem.ID, method, webhookURL)
		log.Printf("🔍 DEBUG: Update payload: %s", string(jsonData))
	} else {
		// Item doesn't exist, create it using POST
		webhookURL = "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item"
		method = "POST"
		log.Printf("➕ CREATE: Creating new Vaultwarden item '%s' using %s %s", secretName, method, webhookURL)
		log.Printf("🔍 DEBUG: Create payload: %s", string(jsonData))
	}
	
	// Create HTTP request to Bitwarden CLI API
	req, err := http.NewRequest(method, webhookURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("error creating API request: %v", err)
	}
	
	req.Header.Set("Content-Type", "application/json")
	
	// Send request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error sending API request: %v", err)
	}
	defer resp.Body.Close()
	
	// Read response body for logging
	responseBody := make([]byte, 1024) // Read first 1KB for logging
	n, _ := resp.Body.Read(responseBody)
	responseStr := string(responseBody[:n])
	
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		log.Printf("API call failed - Status: %d, Response: %s", resp.StatusCode, responseStr)
		
		// If update failed, try to delete and recreate as a LAST RESORT
		// WARNING: This will lose any manually added fields not managed by secret-generator
		if method == "PUT" && existingItem != nil {
			log.Printf("⚠️  WARNING: Update failed with status %d. As a last resort, attempting to delete and recreate item '%s'", resp.StatusCode, secretName)
			log.Printf("⚠️  WARNING: This will PERMANENTLY DELETE any manually added fields in Vaultwarden item '%s'", secretName)
			log.Printf("⚠️  WARNING: Existing fields that will be lost: %v", getFieldNames(existingItem.Fields, secretData))
			
			// Delete the existing item
			deleteURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item/" + existingItem.ID
			deleteReq, err := http.NewRequest("DELETE", deleteURL, nil)
			if err != nil {
				return fmt.Errorf("error creating delete request: %v", err)
			}
			
			deleteResp, err := client.Do(deleteReq)
			if err != nil {
				return fmt.Errorf("error deleting existing item: %v", err)
			}
			
			// Read delete response for logging
			deleteBody := make([]byte, 1024)
			dn, _ := deleteResp.Body.Read(deleteBody)
			deleteRespStr := string(deleteBody[:dn])
			deleteResp.Body.Close()
			
			log.Printf("Delete attempt - Status: %d, Response: %s", deleteResp.StatusCode, deleteRespStr)
			
			if deleteResp.StatusCode == http.StatusOK || deleteResp.StatusCode == http.StatusNoContent {
				// Successfully deleted, now create a new one with ONLY our managed fields
				newItem := map[string]interface{}{
					"organizationId": nil,
					"folderId":       nil,
					"type":           2, // Secure Note type
					"name":           secretName,
					"notes":          fmt.Sprintf("Generated by secret-generator for %s (recreated)", secretName),
					"favorite":       false,
					"secureNote": map[string]interface{}{
						"type": 0, // Generic secure note
					},
					"fields": []map[string]interface{}{},
					"login":    nil,
					"card":     nil,
					"identity": nil,
				}
				
				// Add only our managed secret fields
				for key, value := range secretData {
					field := map[string]interface{}{
						"name":  key,
						"value": value,
						"type":  1, // Hidden field type
					}
					newItem["fields"] = append(newItem["fields"].([]map[string]interface{}), field)
				}
				
				jsonData, err = json.Marshal(newItem)
				if err != nil {
					return fmt.Errorf("error marshaling item for recreation: %v", err)
				}
				
				createURL := "http://vaultwarden-cli.global-secrets.svc.cluster.local:8087/object/item"
				createReq, err := http.NewRequest("POST", createURL, bytes.NewBuffer(jsonData))
				if err != nil {
					return fmt.Errorf("error creating recreation request: %v", err)
				}
				createReq.Header.Set("Content-Type", "application/json")
				
				createResp, err := client.Do(createReq)
				if err != nil {
					return fmt.Errorf("error recreating item: %v", err)
				}
				
				// Read create response for logging
				createBody := make([]byte, 1024)
				cn, _ := createResp.Body.Read(createBody)
				createRespStr := string(createBody[:cn])
				createResp.Body.Close()
				
				log.Printf("Recreation attempt - Status: %d, Response: %s", createResp.StatusCode, createRespStr)
				
				if createResp.StatusCode == http.StatusOK || createResp.StatusCode == http.StatusCreated {
					log.Printf("Successfully recreated Vaultwarden item '%s' (some fields may have been lost)", secretName)
					return nil
				} else {
					return fmt.Errorf("recreation failed with status %d: %s", createResp.StatusCode, createRespStr)
				}
			} else {
				return fmt.Errorf("delete failed with status %d: %s", deleteResp.StatusCode, deleteRespStr)
			}
		}
		return fmt.Errorf("API returned status %d: %s", resp.StatusCode, responseStr)
	}
	
	log.Printf("API call successful - Status: %d, Response: %s", resp.StatusCode, responseStr)
	log.Printf("Successfully synced secret '%s' to Vaultwarden via Bitwarden CLI API", secretName)
	return nil
}

func readConfigFile(filename string) ([]RandomSecret, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("Unable to read config file: %v", err)
	}

	var randomSecrets []RandomSecret
	err = yaml.Unmarshal(data, &randomSecrets)
	if err != nil {
		return nil, fmt.Errorf("Error parsing config file: %v", err)
	}

	return randomSecrets, nil
}

func createOrUpdateSecret(client *kubernetes.Clientset, name string, randomSecret RandomSecret) error {
	// Set default sync direction if not specified
	syncDirection := randomSecret.SyncDirection
	if syncDirection == "" {
		syncDirection = "kubernetes-to-vaultwarden" // Default behavior
	}

	// Validate configuration: warn if syncDirection expects Vaultwarden but syncTo doesn't include it
	if (syncDirection == "vaultwarden-to-kubernetes" || syncDirection == "bidirectional") &&
		!contains(randomSecret.SyncTo, "vaultwarden") {
		log.Printf("⚠️  WARNING: Secret '%s' has syncDirection='%s' but 'vaultwarden' is not in syncTo. "+
			"This may cause unexpected behavior. Add 'vaultwarden' to syncTo for proper operation.", name, syncDirection)
	}

	// Get existing data from both sources
	var k8sSecretData map[string]string
	var vaultwardenSecretData map[string]string
	
	// Get Kubernetes secret data
	secret, k8sErr := client.CoreV1().Secrets(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if k8sErr == nil {
		k8sSecretData = make(map[string]string)
		for key, value := range secret.Data {
			k8sSecretData[key] = string(value)
		}
	}
	
	// Get Vaultwarden data if needed
	if contains(randomSecret.SyncTo, "vaultwarden") {
		vaultwardenItem, err := getVaultwardenItem(name)
		if err != nil {
			log.Printf("Warning: Could not get Vaultwarden item '%s': %v", name, err)
			vaultwardenSecretData = make(map[string]string)
		} else {
			vaultwardenSecretData = getVaultwardenSecretData(vaultwardenItem)
		}
	}
	
	// Determine the source of truth based on sync direction
	var finalSecretData map[string]string
	
	switch syncDirection {
	case "vaultwarden-to-kubernetes":
		// Vaultwarden is source of truth
		finalSecretData = vaultwardenSecretData
		if finalSecretData == nil {
			finalSecretData = make(map[string]string)
		}
		// Generate missing keys
		for _, randomPassword := range randomSecret.Data {
			if _, exists := finalSecretData[randomPassword.Key]; !exists {
				password, err := generateRandomPassword(randomPassword.Length, randomPassword.Special)
				if err != nil {
					log.Printf("Error generating password for key '%s': %v", randomPassword.Key, err)
					continue
				}
				finalSecretData[randomPassword.Key] = password
				log.Printf("Generated new password for missing key '%s'", randomPassword.Key)
			}
		}
		
	case "bidirectional":
		// Merge both sources, preferring newer values
		finalSecretData = make(map[string]string)
		
		// Start with Kubernetes data
		for key, value := range k8sSecretData {
			finalSecretData[key] = value
		}
		
		// Overlay Vaultwarden data (you could add timestamp logic here)
		for key, value := range vaultwardenSecretData {
			finalSecretData[key] = value
		}
		
		// Generate missing keys
		for _, randomPassword := range randomSecret.Data {
			if _, exists := finalSecretData[randomPassword.Key]; !exists {
				password, err := generateRandomPassword(randomPassword.Length, randomPassword.Special)
				if err != nil {
					log.Printf("Error generating password for key '%s': %v", randomPassword.Key, err)
					continue
				}
				finalSecretData[randomPassword.Key] = password
				log.Printf("Generated new password for missing key '%s'", randomPassword.Key)
			}
		}
		
	default: // "kubernetes-to-vaultwarden"
		// Kubernetes is source of truth
		finalSecretData = k8sSecretData
		if finalSecretData == nil {
			finalSecretData = make(map[string]string)
		}
		
		// Generate missing keys
		for _, randomPassword := range randomSecret.Data {
			if _, exists := finalSecretData[randomPassword.Key]; !exists {
				password, err := generateRandomPassword(randomPassword.Length, randomPassword.Special)
				if err != nil {
					log.Printf("Error generating password for key '%s': %v", randomPassword.Key, err)
					continue
				}
				finalSecretData[randomPassword.Key] = password
				log.Printf("Generated new password for missing key '%s'", randomPassword.Key)
			}
		}
	}
	
	// Sync to Kubernetes if specified
	if contains(randomSecret.SyncTo, "kubernetes") {
		secretDataBytes := make(map[string][]byte)
		for key, value := range finalSecretData {
			secretDataBytes[key] = []byte(value)
		}
		
		if k8sErr != nil {
			// Secret doesn't exist, create it
			newSecret := &v1.Secret{
				ObjectMeta: metav1.ObjectMeta{
					Name:      name,
					Namespace: namespace,
				},
				Data: secretDataBytes,
			}
			
			_, err := client.CoreV1().Secrets(namespace).Create(context.Background(), newSecret, metav1.CreateOptions{})
			if err != nil {
				return fmt.Errorf("Unable to create secret: %v", err)
			}
			log.Printf("Secret '%s' created successfully in Kubernetes.", name)
		} else {
			// Secret exists, update it
			secret.Data = secretDataBytes
			_, err := client.CoreV1().Secrets(namespace).Update(context.Background(), secret, metav1.UpdateOptions{})
			if err != nil {
				return fmt.Errorf("Unable to update secret: %v", err)
			}
			log.Printf("Secret '%s' updated successfully in Kubernetes.", name)
		}
	}
	
	// Sync to Vaultwarden if specified
	if contains(randomSecret.SyncTo, "vaultwarden") {
		err := syncToVaultwarden(name, finalSecretData)
		if err != nil {
			log.Printf("Error syncing to Vaultwarden: %v", err)
		}
	}
	
	return nil
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func main() {
	configFilename := "./config.yaml"
	randomSecrets, err := readConfigFile(configFilename)
	if err != nil {
		log.Fatalf("Error reading config file: %v", err)
	}

	client, err := getClient()
	if err != nil {
		log.Fatalf("Unable to create Kubernetes client: %v", err)
	}

	for _, randomSecret := range randomSecrets {
		// Default to Kubernetes if no syncTo specified (backward compatibility)
		if len(randomSecret.SyncTo) == 0 {
			randomSecret.SyncTo = []string{"kubernetes"}
		}
		
		err := createOrUpdateSecret(client, randomSecret.Name, randomSecret)
		if err != nil {
			log.Printf("Error processing secret %s: %v", randomSecret.Name, err)
		}
	}
}
